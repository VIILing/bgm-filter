import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { CoverUrls } from "~/shared/subject-contract";

/**
 * 封面 URL 缓存（独立 SQLite，绝不写进 `Subject` 表）。
 *
 * 正向缓存（有封面）永久有效；负向缓存按原因区分 TTL：
 * - `not_found`（上游 404，可能是 NSFW 未认证/条目删除）1 天，便于补 token 后重试；
 * - `no_image`（200 但 images 全空）/ `unknown` 7 天，避免反复回源。
 */
export const DEFAULT_COVER_CACHE_PATH = ".cache/covers.db";

/**
 * 缓存策略版本，写入 SQLite `PRAGMA user_version`：
 * - v2：取消封面 NSFW 门禁，清空旧 NSFW 负缓存；
 * - v3：负缓存增加原因列（区分 404 / 无图），并清空 v2 阶段遗留的负缓存，
 *   使配置 `BGM_API_TOKEN` 后旧的 404 负缓存不会继续挡住 NSFW 条目；
 * - v4：增加 `summary` / `summaryFetched` 列，与封面同源缓存简介；仅加列，
 *   **不清任何缓存**（v3 的有效正/负缓存全部保留，旧行 summaryFetched=0 表示
 *   简介未知，首次请求简介时按需回源）。
 */
export const COVER_CACHE_VERSION = 4;

/** 负缓存原因；`ok` 仅用于正缓存。 */
export type CoverCacheReason =
  | "ok"
  | "no_image"
  | "not_found"
  | "unknown";

/** 缓存中的一行；`missing=true` 表示负缓存。 */
export interface CoverCacheEntry {
  grid: string | null;
  small: string | null;
  common: string | null;
  /** 缓存的简介；`summaryFetched=false` 时无意义（尚未取到）。 */
  summary: string | null;
  /** true=简介已有定论（有值或确定为空/404）。 */
  summaryFetched: boolean;
  missing: boolean;
  reason: CoverCacheReason;
  fetchedAt: number;
}

/** 待写入缓存的一条结果；`urls=null` 写入负缓存。 */
export interface CoverCacheWrite {
  id: number;
  urls: CoverUrls | null;
  /** 简介（`null` 表示无简介或 404）；写入即视为 summaryFetched=1。 */
  summary: string | null;
  fetchedAt: number;
  /** 负缓存原因；缺省时负缓存按 `unknown`（7 天 TTL）处理。 */
  reason?: CoverCacheReason;
}

interface CoverCacheRow {
  id: number | bigint;
  grid: string | null;
  small: string | null;
  common: string | null;
  summary: string | null;
  summaryFetched: number | bigint;
  fetchedAt: number | bigint;
  missing: number | bigint;
  reason: string | null;
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS cover_cache (
    id        INTEGER PRIMARY KEY,
    grid      TEXT,
    small     TEXT,
    common    TEXT,
    summary   TEXT,
    summaryFetched INTEGER NOT NULL DEFAULT 0,
    "fetchedAt" INTEGER NOT NULL,
    missing   INTEGER NOT NULL DEFAULT 0,
    reason    TEXT NOT NULL DEFAULT 'unknown'
  )
`;

const UPSERT_SQL = `
  INSERT INTO cover_cache (id, grid, small, common, summary, summaryFetched, "fetchedAt", missing, reason)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    grid = excluded.grid,
    small = excluded.small,
    common = excluded.common,
    summary = excluded.summary,
    summaryFetched = excluded.summaryFetched,
    "fetchedAt" = excluded."fetchedAt",
    missing = excluded.missing,
    reason = excluded.reason
`;

/**
 * `node:sqlite` 的同步缓存。`.cache/` 不存在时自动创建；`:memory:` 用于测试。
 *
 * 多进程注意：SQLite 本身支持多连接，但写锁是排他的。这里设置
 * `busy_timeout=5000` + WAL，避免 dev / test / 脚本同时写时报 SQLITE_BUSY。
 */
export class CoverCache {
  private readonly db: DatabaseSync;
  private closed = false;

  constructor(filePath: string = DEFAULT_COVER_CACHE_PATH) {
    if (filePath !== ":memory:") {
      mkdirSync(dirname(resolve(filePath)), { recursive: true });
    }
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA busy_timeout = 5000");
    if (filePath !== ":memory:") {
      // WAL 让读不阻塞写；失败时（只读文件系统等）退回默认 journal。
      try {
        this.db.exec("PRAGMA journal_mode = WAL");
      } catch {
        // 忽略：缓存不是关键路径
      }
    }
    this.db.exec(CREATE_TABLE_SQL);
    this.ensureReasonColumn();
    this.ensureSummaryColumns();
    this.migrate();
  }

  /** 旧库升级：补 `reason` 列（默认 unknown），保证读写 SQL 向后兼容。 */
  private ensureReasonColumn(): void {
    const columns = this.db
      .prepare("PRAGMA table_info(cover_cache)")
      .all() as unknown as Array<{ name?: string }>;
    if (columns.some((column) => column.name === "reason")) return;
    this.db.exec(
      "ALTER TABLE cover_cache ADD COLUMN reason TEXT NOT NULL DEFAULT 'unknown'",
    );
  }

  /** v4：补 `summary` / `summaryFetched` 列；旧行 summaryFetched 默认 0（简介未知）。 */
  private ensureSummaryColumns(): void {
    const columns = this.db
      .prepare("PRAGMA table_info(cover_cache)")
      .all() as unknown as Array<{ name?: string }>;
    if (!columns.some((column) => column.name === "summary")) {
      this.db.exec("ALTER TABLE cover_cache ADD COLUMN summary TEXT");
    }
    if (!columns.some((column) => column.name === "summaryFetched")) {
      this.db.exec(
        "ALTER TABLE cover_cache ADD COLUMN summaryFetched INTEGER NOT NULL DEFAULT 0",
      );
    }
  }

  /**
   * 幂等、分版本迁移：
   * - v0/v1/v2 → v3：清空全部 `missing=1` 负缓存（NSFW 门禁取消 / 引入 reason），
   *   并把旧正缓存的 reason 补成 `ok`；
   * - v3 → v4：仅加 `summary` / `summaryFetched` 列（由 ensureSummaryColumns 完成），
   *   **不清任何缓存**（v3 的有效正/负缓存全部保留）。
   *
   * 迁移失败不影响服务：保留原库继续用，下次打开会重试，绝不让 covers 接口因
   * 缓存迁移报错。
   */
  private migrate(): void {
    try {
      const current = this.readUserVersion();
      if (current >= COVER_CACHE_VERSION) return;

      this.db.exec("BEGIN IMMEDIATE");
      try {
        // 事务内二次检查：多进程同时打开时，后拿到写锁的进程会看到已迁移版本，
        // 不会重复执行迁移步骤。
        const version = this.readUserVersion();
        if (version < COVER_CACHE_VERSION) {
          if (version < 3) {
            this.db.exec("DELETE FROM cover_cache WHERE missing = 1");
            this.db.exec(
              "UPDATE cover_cache SET reason = 'ok' WHERE missing = 0 AND reason = 'unknown'",
            );
          }
          // v3 → v4 只有加列（已由 ensureSummaryColumns 在事务外完成），不删任何行。
          this.db.exec(`PRAGMA user_version = ${COVER_CACHE_VERSION}`);
        }
        this.db.exec("COMMIT");
      } catch (error) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
          // 事务可能已被 SQLite 自动回滚
        }
        throw error;
      }
    } catch (error) {
      // 缓存不是关键路径：打印一次，保留旧数据继续服务。
      console.warn("[cover-cache] 迁移失败，下次打开重试", error);
    }
  }

  private readUserVersion(): number {
    const row = this.db.prepare("PRAGMA user_version").get() as
      | { user_version?: number | bigint }
      | undefined;
    return Number(row?.user_version ?? 0);
  }

  /**
   * 读取缓存命中项；过期负缓存视为未命中（不返回）。
   * 404 使用 `notFoundTtlMs`，无图/unknown 使用 `negativeTtlMs`。
   */
  getMany(
    ids: readonly number[],
    now: number,
    negativeTtlMs: number,
    notFoundTtlMs: number = negativeTtlMs,
  ): Map<number, CoverCacheEntry> {
    const hits = new Map<number, CoverCacheEntry>();
    if (ids.length === 0 || this.closed) return hits;

    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT id, grid, small, common, summary, summaryFetched, "fetchedAt", missing, reason
           FROM cover_cache
          WHERE id IN (${placeholders})`,
      )
      .all(...ids) as unknown as CoverCacheRow[];

    for (const row of rows) {
      const missing = Number(row.missing) !== 0;
      const reason = normalizeReason(row.reason);
      const fetchedAt = Number(row.fetchedAt);
      if (missing) {
        const ttl = reason === "not_found" ? notFoundTtlMs : negativeTtlMs;
        if (now - fetchedAt >= ttl) continue;
      }
      hits.set(Number(row.id), {
        grid: normalizeText(row.grid),
        small: normalizeText(row.small),
        common: normalizeText(row.common),
        summary: normalizeText(row.summary),
        summaryFetched: Number(row.summaryFetched) !== 0,
        missing,
        reason,
        fetchedAt,
      });
    }
    return hits;
  }

  /** 批量写入（单事务），正/负缓存统一走 upsert。 */
  setMany(entries: readonly CoverCacheWrite[]): void {
    if (entries.length === 0 || this.closed) return;

    const statement = this.db.prepare(UPSERT_SQL);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const entry of entries) {
        const reason: CoverCacheReason = entry.urls
          ? "ok"
          : entry.reason && entry.reason !== "ok"
            ? entry.reason
            : "unknown";
        statement.run(
          entry.id,
          entry.urls?.grid ?? null,
          entry.urls?.small ?? null,
          entry.urls?.common ?? null,
          entry.summary ?? null,
          1, // summaryFetched：每次写入都来自一次已完成的回源，简介已有定论
          entry.fetchedAt,
          entry.urls === null ? 1 : 0,
          reason,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // 事务可能已被 SQLite 自动回滚
      }
      throw error;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}

function normalizeReason(value: string | null): CoverCacheReason {
  return value === "ok" ||
    value === "no_image" ||
    value === "not_found" ||
    value === "unknown"
    ? value
    : "unknown";
}

function normalizeText(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
