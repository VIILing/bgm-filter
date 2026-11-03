/**
 * `CoverCache` 迁移单测：旧库 `user_version=0` 且含负缓存 → 打开时清空负缓存、
 * 保留正缓存并写入当前版本；已迁移库重复打开不再重复清理。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  COVER_CACHE_VERSION,
  CoverCache,
} from "./cover-cache";

/** 与 cover-service 的 TTL 保持一致（无图 7 天 / 404 1 天）；此测试只验证迁移。 */
const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NOT_FOUND_TTL_MS = 24 * 60 * 60 * 1000;

interface SeedRow {
  id: number;
  urls: { grid: string; small: string; common: string } | null;
  fetchedAt: number;
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

const tempDirs: string[] = [];
const openedCaches: CoverCache[] = [];

function createTempCachePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "bgm-cover-migration-"));
  tempDirs.push(dir);
  return join(dir, "covers.db");
}

function openCache(path: string): CoverCache {
  const cache = new CoverCache(path);
  openedCaches.push(cache);
  return cache;
}

/** 造一个旧版本缓存库（user_version 由调用方指定）。 */
function seedCache(path: string, rows: readonly SeedRow[], version: number): void {
  const db = new DatabaseSync(path);
  db.exec(CREATE_TABLE_SQL);
  const statement = db.prepare(
    `INSERT INTO cover_cache (id, grid, small, common, "fetchedAt", missing)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows) {
    statement.run(
      row.id,
      row.urls?.grid ?? null,
      row.urls?.small ?? null,
      row.urls?.common ?? null,
      row.fetchedAt,
      row.urls === null ? 1 : 0,
    );
  }
  db.exec(`PRAGMA user_version = ${version}`);
  db.close();
}

function readVersion(path: string): number {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db.prepare("PRAGMA user_version").get() as {
      user_version: number | bigint;
    };
    return Number(row.user_version);
  } finally {
    db.close();
  }
}

afterEach(() => {
  for (const cache of openedCaches.splice(0)) cache.close();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("CoverCache 负缓存迁移", () => {
  it("v0 旧库：清空负缓存、保留正缓存并写入 user_version=3", () => {
    const path = createTempCachePath();
    const now = Date.now();
    seedCache(
      path,
      [
        {
          id: 1,
          urls: { grid: "g1", small: "s1", common: "c1" },
          fetchedAt: now,
        },
        { id: 22290, urls: null, fetchedAt: now },
        { id: 99999999, urls: null, fetchedAt: now },
      ],
      0,
    );

    const cache = openCache(path);
    const hits = cache.getMany(
      [1, 22290, 99999999],
      now,
      NEGATIVE_TTL_MS,
      NOT_FOUND_TTL_MS,
    );
    // 负缓存已清空；positive 保留且 reason 补成 ok
    expect([...hits.keys()]).toEqual([1]);
    expect(hits.get(1)).toMatchObject({
      missing: false,
      reason: "ok",
      grid: "g1",
      small: "s1",
      common: "c1",
    });
    cache.close();

    const db = new DatabaseSync(path, { readOnly: true });
    const version = db.prepare("PRAGMA user_version").get() as {
      user_version: number | bigint;
    };
    const counts = db
      .prepare(
        "SELECT COUNT(*) AS total, COALESCE(SUM(missing), 0) AS missing FROM cover_cache",
      )
      .get() as { total: number | bigint; missing: number | bigint };
    const columns = db
      .prepare("PRAGMA table_info(cover_cache)")
      .all() as unknown as Array<{ name?: string }>;
    db.close();

    expect(Number(version.user_version)).toBe(COVER_CACHE_VERSION);
    expect(Number(counts.total)).toBe(1);
    expect(Number(counts.missing)).toBe(0);
    expect(columns.some((column) => column.name === "reason")).toBe(true);
  });

  it("v2 → v3：清空旧负缓存、保留正缓存并升级版本", () => {
    const path = createTempCachePath();
    const now = Date.now();
    seedCache(
      path,
      [
        {
          id: 1,
          urls: { grid: "g1", small: "s1", common: "c1" },
          fetchedAt: now,
        },
        { id: 226254, urls: null, fetchedAt: now },
      ],
      2,
    );

    const cache = openCache(path);
    const hits = cache.getMany(
      [1, 226254],
      now,
      NEGATIVE_TTL_MS,
      NOT_FOUND_TTL_MS,
    );
    expect([...hits.keys()]).toEqual([1]);
    expect(hits.get(1)?.reason).toBe("ok");
    cache.close();
    expect(readVersion(path)).toBe(COVER_CACHE_VERSION);
  });

  it("重复打开不重复清理：迁移后新增的负缓存会保留", () => {
    const path = createTempCachePath();
    const now = Date.now();
    seedCache(
      path,
      [
        {
          id: 1,
          urls: { grid: "g1", small: "s1", common: "c1" },
          fetchedAt: now,
        },
        { id: 2, urls: null, fetchedAt: now },
      ],
      0,
    );

    // 第一次打开触发迁移，旧负缓存被清空
    const first = openCache(path);
    first.close();

    // 迁移后写入的新负缓存（例如官方确认无图）不应在下一次打开时被清掉
    const second = openCache(path);
    second.setMany([
      { id: 777, urls: null, fetchedAt: now, reason: "not_found" },
    ]);
    second.close();

    const third = openCache(path);
    const hits = third.getMany(
      [1, 777],
      now,
      NEGATIVE_TTL_MS,
      NOT_FOUND_TTL_MS,
    );
    expect([...hits.keys()].sort((a, b) => a - b)).toEqual([1, 777]);
    expect(hits.get(1)?.missing).toBe(false);
    expect(hits.get(777)?.missing).toBe(true);
    expect(hits.get(777)?.reason).toBe("not_found");
    expect(readVersion(path)).toBe(COVER_CACHE_VERSION);
  });

  it("全新空库直接标记为当前版本", () => {
    const path = createTempCachePath();
    const cache = openCache(path);
    cache.close();
    expect(readVersion(path)).toBe(COVER_CACHE_VERSION);
  });
});
