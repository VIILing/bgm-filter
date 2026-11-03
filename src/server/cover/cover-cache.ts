import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { CoverUrls } from "~/shared/subject-contract";

/**
 * 封面 URL 缓存（独立 SQLite，绝不写进 `Subject` 表）。
 *
 * 正向缓存（有封面）永久有效；负向缓存（无封面 / NSFW / 404）由调用方按
 * `negativeTtlMs` 判断过期，避免对同一批空封面条目反复回源。
 */
export const DEFAULT_COVER_CACHE_PATH = ".cache/covers.db";

/** 缓存中的一行；`missing=true` 表示负缓存。 */
export interface CoverCacheEntry {
  grid: string | null;
  small: string | null;
  common: string | null;
  missing: boolean;
  fetchedAt: number;
}

/** 待写入缓存的一条结果；`urls=null` 写入负缓存。 */
export interface CoverCacheWrite {
  id: number;
  urls: CoverUrls | null;
  fetchedAt: number;
}

interface CoverCacheRow {
  id: number | bigint;
  grid: string | null;
  small: string | null;
  common: string | null;
  fetchedAt: number | bigint;
  missing: number | bigint;
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS cover_cache (
    id        INTEGER PRIMARY KEY,
    grid      TEXT,
    small     TEXT,
    common    TEXT,
    "fetchedAt" INTEGER NOT NULL,
    missing   INTEGER NOT NULL DEFAULT 0
  )
`;

const UPSERT_SQL = `
  INSERT INTO cover_cache (id, grid, small, common, "fetchedAt", missing)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    grid = excluded.grid,
    small = excluded.small,
    common = excluded.common,
    "fetchedAt" = excluded."fetchedAt",
    missing = excluded.missing
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
  }

  /** 读取缓存命中项；过期负缓存视为未命中（不返回）。 */
  getMany(
    ids: readonly number[],
    now: number,
    negativeTtlMs: number,
  ): Map<number, CoverCacheEntry> {
    const hits = new Map<number, CoverCacheEntry>();
    if (ids.length === 0 || this.closed) return hits;

    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT id, grid, small, common, "fetchedAt", missing
           FROM cover_cache
          WHERE id IN (${placeholders})`,
      )
      .all(...ids) as unknown as CoverCacheRow[];

    for (const row of rows) {
      const missing = Number(row.missing) !== 0;
      const fetchedAt = Number(row.fetchedAt);
      if (missing && now - fetchedAt >= negativeTtlMs) continue;
      hits.set(Number(row.id), {
        grid: normalizeText(row.grid),
        small: normalizeText(row.small),
        common: normalizeText(row.common),
        missing,
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
        statement.run(
          entry.id,
          entry.urls?.grid ?? null,
          entry.urls?.small ?? null,
          entry.urls?.common ?? null,
          entry.fetchedAt,
          entry.urls === null ? 1 : 0,
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

function normalizeText(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
