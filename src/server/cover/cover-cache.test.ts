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
  deriveLargeUrl,
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
  it("v0 旧库：清空负缓存、保留正缓存并写入当前版本", () => {
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
      large: null, // "c1" 不是可推导的缩放 URL
      summary: null,
      summaryFetched: false,
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
    expect(columns.some((column) => column.name === "summary")).toBe(true);
    expect(columns.some((column) => column.name === "summaryFetched")).toBe(true);
    expect(columns.some((column) => column.name === "large")).toBe(true);
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

  it("v3 → v5：仅补列、不清负缓存", () => {
    const path = createTempCachePath();
    const now = Date.now();

    // 造一个真实 v3 库：含 reason 列，正缓存 reason='ok'、负缓存 reason='not_found'。
    const v3 = new DatabaseSync(path);
    v3.exec(`
      CREATE TABLE cover_cache (
        id        INTEGER PRIMARY KEY,
        grid      TEXT,
        small     TEXT,
        common    TEXT,
        "fetchedAt" INTEGER NOT NULL,
        missing   INTEGER NOT NULL DEFAULT 0,
        reason    TEXT NOT NULL DEFAULT 'unknown'
      )
    `);
    const insert = v3.prepare(
      `INSERT INTO cover_cache (id, grid, small, common, "fetchedAt", missing, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(1, "g1", "s1", "c1", now, 0, "ok");
    insert.run(226254, null, null, null, now, 1, "not_found");
    v3.exec("PRAGMA user_version = 3");
    v3.close();

    const cache = openCache(path);
    const hits = cache.getMany(
      [1, 226254],
      now,
      NEGATIVE_TTL_MS,
      NOT_FOUND_TTL_MS,
    );
    // v3 的正/负缓存都保留；旧行 summary 未知（summaryFetched=false，等按需回源）。
    expect([...hits.keys()].sort((a, b) => a - b)).toEqual([1, 226254]);
    expect(hits.get(1)).toMatchObject({
      missing: false,
      reason: "ok",
      grid: "g1",
      large: null,
      summary: null,
      summaryFetched: false,
    });
    expect(hits.get(226254)).toMatchObject({
      missing: true,
      reason: "not_found",
      summary: null,
      summaryFetched: false,
    });
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
      { id: 777, urls: null, summary: null, fetchedAt: now, reason: "not_found" },
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

describe("CoverCache v4 → v5（large 原图列）", () => {
  interface V4Row {
    id: number;
    grid: string | null;
    small: string | null;
    common: string | null;
    summary: string | null;
    summaryFetched: 0 | 1;
    missing: 0 | 1;
    reason: string;
  }

  /** 造一个真实 v4 库：无 large 列，含 summary / reason。 */
  function seedV4Cache(path: string, rows: readonly V4Row[]): void {
    const db = new DatabaseSync(path);
    db.exec(`
      CREATE TABLE cover_cache (
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
    `);
    const insert = db.prepare(
      `INSERT INTO cover_cache (id, grid, small, common, summary, summaryFetched, "fetchedAt", missing, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = Date.now();
    for (const row of rows) {
      insert.run(
        row.id,
        row.grid,
        row.small,
        row.common,
        row.summary,
        row.summaryFetched,
        now,
        row.missing,
        row.reason,
      );
    }
    db.exec("PRAGMA user_version = 4");
    db.close();
  }

  it("加列不丢行：正/负缓存与简介保留，旧行 large 从 common/small 推导", () => {
    const path = createTempCachePath();
    const now = Date.now();
    seedV4Cache(path, [
      {
        id: 1,
        grid: "https://lain.bgm.tv/r/100/pic/cover/l/c4/ca/1_d2tF2.jpg",
        small: "https://lain.bgm.tv/r/200/pic/cover/l/c4/ca/1_d2tF2.jpg",
        common: "https://lain.bgm.tv/r/400/pic/cover/l/c4/ca/1_d2tF2.jpg",
        summary: "旧简介 1",
        summaryFetched: 1,
        missing: 0,
        reason: "ok",
      },
      {
        id: 2,
        grid: "https://lain.bgm.tv/r/100/pic/cover/l/aa/bb/2_x.jpg",
        small: "https://lain.bgm.tv/r/200/pic/cover/l/aa/bb/2_x.jpg",
        common: null,
        summary: null,
        summaryFetched: 0,
        missing: 0,
        reason: "ok",
      },
      {
        id: 3,
        grid: null,
        small: null,
        common: null,
        summary: null,
        summaryFetched: 1,
        missing: 1,
        reason: "not_found",
      },
      {
        id: 4,
        grid: "g4",
        small: "s4",
        common: "https://lain.bgm.tv/pic/cover/l/aa/bb/4_x.jpg",
        summary: null,
        summaryFetched: 1,
        missing: 0,
        reason: "ok",
      },
    ]);

    const cache = openCache(path);
    const hits = cache.getMany(
      [1, 2, 3, 4],
      now,
      NEGATIVE_TTL_MS,
      NOT_FOUND_TTL_MS,
    );

    expect([...hits.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(hits.get(1)).toMatchObject({
      common: "https://lain.bgm.tv/r/400/pic/cover/l/c4/ca/1_d2tF2.jpg",
      large: "https://lain.bgm.tv/pic/cover/l/c4/ca/1_d2tF2.jpg",
      summary: "旧简介 1",
      summaryFetched: true,
    });
    // common 为空时用 small 推导
    expect(hits.get(2)?.large).toBe(
      "https://lain.bgm.tv/pic/cover/l/aa/bb/2_x.jpg",
    );
    // 负缓存不被 v4 → v5 清掉
    expect(hits.get(3)).toMatchObject({
      missing: true,
      reason: "not_found",
      large: null,
    });
    // 已是原图 / 非标准路径：不猜测，保持 null
    expect(hits.get(4)?.large).toBeNull();

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
    expect(Number(counts.total)).toBe(4);
    expect(Number(counts.missing)).toBe(1);
    expect(columns.some((column) => column.name === "large")).toBe(true);
  });

  it("推导失败的旧行先为 null，正常 setMany 刷新后可拿到真实 large", () => {
    const path = createTempCachePath();
    const now = Date.now();
    seedV4Cache(path, [
      {
        id: 4,
        grid: "g4",
        small: "s4",
        common: "https://lain.bgm.tv/pic/cover/l/aa/bb/4_x.jpg",
        summary: null,
        summaryFetched: 1,
        missing: 0,
        reason: "ok",
      },
    ]);

    const cache = openCache(path);
    expect(
      cache.getMany([4], now, NEGATIVE_TTL_MS, NOT_FOUND_TTL_MS).get(4)?.large,
    ).toBeNull();

    cache.setMany([
      {
        id: 4,
        urls: {
          grid: "g4",
          small: "s4",
          common: "https://lain.bgm.tv/r/400/pic/cover/l/aa/bb/4_x.jpg",
          large: "https://lain.bgm.tv/pic/cover/l/aa/bb/4_x.jpg",
        },
        summary: "刷新后的简介",
        fetchedAt: now,
        reason: "ok",
      },
    ]);

    const refreshed = cache
      .getMany([4], now, NEGATIVE_TTL_MS, NOT_FOUND_TTL_MS)
      .get(4);
    expect(refreshed).toMatchObject({
      large: "https://lain.bgm.tv/pic/cover/l/aa/bb/4_x.jpg",
      summary: "刷新后的简介",
      summaryFetched: true,
    });
    cache.close();
  });

  it("重复打开已升级库幂等：版本不变、行不丢、large 仍可推导", () => {
    const path = createTempCachePath();
    const now = Date.now();
    seedV4Cache(path, [
      {
        id: 1,
        grid: "https://lain.bgm.tv/r/100/pic/cover/l/c4/ca/1_d2tF2.jpg",
        small: "https://lain.bgm.tv/r/200/pic/cover/l/c4/ca/1_d2tF2.jpg",
        common: "https://lain.bgm.tv/r/400/pic/cover/l/c4/ca/1_d2tF2.jpg",
        summary: "简介",
        summaryFetched: 1,
        missing: 0,
        reason: "ok",
      },
    ]);

    const first = openCache(path);
    first.close();
    const second = openCache(path);
    const hits = second.getMany(
      [1],
      now,
      NEGATIVE_TTL_MS,
      NOT_FOUND_TTL_MS,
    );
    expect(hits.get(1)?.large).toBe(
      "https://lain.bgm.tv/pic/cover/l/c4/ca/1_d2tF2.jpg",
    );
    expect(hits.get(1)?.summary).toBe("简介");
    second.close();
    expect(readVersion(path)).toBe(COVER_CACHE_VERSION);
  });
});

describe("deriveLargeUrl", () => {
  it("去掉 /r/<数字>/ 段并保留主机与路径（http/https）", () => {
    expect(
      deriveLargeUrl(
        "https://lain.bgm.tv/r/400/pic/cover/l/c4/ca/1_d2tF2.jpg",
      ),
    ).toBe("https://lain.bgm.tv/pic/cover/l/c4/ca/1_d2tF2.jpg");
    expect(deriveLargeUrl("http://lain.bgm.tv/r/100/a.jpg")).toBe(
      "http://lain.bgm.tv/a.jpg",
    );
    expect(deriveLargeUrl("  https://lain.bgm.tv/r/200/x/y.jpg  ")).toBe(
      "https://lain.bgm.tv/x/y.jpg",
    );
  });

  it("无 /r/ 数字段 / 非 http(s) / 空值/空白 → null", () => {
    expect(deriveLargeUrl("https://lain.bgm.tv/pic/cover/l/c4/ca/1.jpg")).toBeNull();
    expect(deriveLargeUrl("https://lain.bgm.tv/r/abc/1.jpg")).toBeNull();
    expect(deriveLargeUrl("https://lain.bgm.tv/r/400/")).toBeNull();
    expect(deriveLargeUrl("//lain.bgm.tv/r/400/1.jpg")).toBeNull();
    expect(deriveLargeUrl("/r/400/1.jpg")).toBeNull();
    expect(deriveLargeUrl("")).toBeNull();
    expect(deriveLargeUrl("   ")).toBeNull();
    expect(deriveLargeUrl(null)).toBeNull();
    expect(deriveLargeUrl(undefined)).toBeNull();
  });
});
