/**
 * 真实数据集成测试（`prisma/dev.db`）。
 *
 * 与 `test-fixture.ts` 的单测不同：这里直接读真实导入的 dev.db，用于校验
 * 「SQL / 排序 / 分页 / 统计」在 700,108 条数据上的行为与数据报告一致。
 *
 * - dev.db 不存在 / 表不存在 / 无数据 → 整个 suite `describe.skipIf` 跳过；
 * - 有数据时断言基线数字（700,108 / 7,331 / 8,084 / 31,258 / 422,912 …），
 *   因此「半导入」的库会直接失败，而不会被静默放过；
 * - 只读，不写 dev.db。
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SearchInput } from "~/shared/subject-contract";
import { createCaller } from "~/server/api/root";
import {
  getSubjectStats,
  searchSubjects,
  searchTags,
} from "~/server/search/subject-search";

const DEV_DB_PATH = fileURLToPath(
  new URL("../../../prisma/dev.db", import.meta.url),
);

interface Availability {
  available: boolean;
  reason: string;
}

/** 同步探测：文件存在 + 能读出非空 Subject 表。 */
function inspectDevDatabase(): Availability {
  if (!existsSync(DEV_DB_PATH)) {
    return { available: false, reason: "prisma/dev.db 不存在" };
  }
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(DEV_DB_PATH, { readOnly: true });
    const row = database
      .prepare(`SELECT COUNT(*) AS c FROM "Subject"`)
      .get() as { c?: number | bigint } | undefined;
    const total = Number(row?.c ?? 0);
    return total > 0
      ? { available: true, reason: `Subject ${total} 行` }
      : { available: false, reason: "Subject 表为空" };
  } catch (error) {
    return {
      available: false,
      reason: `无法读取 dev.db：${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    database?.close();
  }
}

const availability = inspectDevDatabase();
if (!availability.available) {
  console.warn(`[integration] 跳过真实数据测试：${availability.reason}`);
}

/** 输入补全：SearchInput 的默认值与 contract 一致。 */
const BASE_INPUT: SearchInput = {
  tagExpr: "",
  q: "",
  sort: "score_desc",
  scoreless: "last",
  page: 1,
};

function input(overrides: Partial<SearchInput> = {}): SearchInput {
  return { ...BASE_INPUT, ...overrides };
}

interface CountRow {
  c: number | bigint;
}

interface SubjectTagNameRow {
  id: number | bigint;
  nameLower: string;
}

/** 取一组 subjectId 的完整标签集合（nameLower），用于校验「语义上的标签命中」。 */
async function tagSetsOf(
  client: PrismaClient,
  ids: number[],
): Promise<Map<number, Set<string>>> {
  const result = new Map<number, Set<string>>();
  if (ids.length === 0) return result;
  const rows = await client.$queryRawUnsafe<SubjectTagNameRow[]>(
    [
      `SELECT st."subjectId" AS id, t."nameLower" AS nameLower`,
      `FROM "SubjectTag" st`,
      `JOIN "Tag" t ON t."id" = st."tagId"`,
      `WHERE st."subjectId" IN (${ids.map(() => "?").join(", ")})`,
    ].join(" "),
    ...ids,
  );
  for (const row of rows) {
    const id = Number(row.id);
    const set = result.get(id);
    if (set) set.add(row.nameLower);
    else result.set(id, new Set([row.nameLower]));
  }
  return result;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function ms(value: number): string {
  return `${value.toFixed(1)} ms`;
}

describe.skipIf(!availability.available)(
  `subject-search（真实数据：${availability.reason}）`,
  () => {
    let client: PrismaClient;

    beforeAll(() => {
      client = new PrismaClient({
        datasourceUrl: `file:${DEV_DB_PATH}`,
        log: ["error"],
      });
    });

    afterAll(async () => {
      await client.$disconnect();
    });

    it("默认搜索：total=700108、首页 50 条、score 降序且 0 分在最后", async () => {
      const result = await searchSubjects(input(), client);

      expect(result.total).toBe(700_108);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(50);
      expect(result.totalPages).toBe(14_003);
      expect(result.items).toHaveLength(50);
      expect(result.warnings).toEqual([]);
      expect(result.parsedTags).toEqual([]);

      const scores = result.items.map((item) => item.score);
      // 首页全部有评分（总数据 287,448 条有评分，首页轮不到 0 分）。
      expect(scores.every((score) => score > 0)).toBe(true);
      for (let index = 1; index < scores.length; index += 1) {
        expect(scores[index]!).toBeLessThanOrEqual(scores[index - 1]!);
      }
      // 稳定排序：同分时 id 升序。
      for (let index = 1; index < result.items.length; index += 1) {
        const previous = result.items[index - 1]!;
        const current = result.items[index]!;
        if (previous.score === current.score) {
          expect(current.id).toBeGreaterThan(previous.id);
        }
      }
    });

    it("标签计数：科幻 7,331；百合 8,084；交集 ∈ (0, 7,331]", async () => {
      const scifi = await searchSubjects(input({ tagExpr: "科幻" }), client);
      expect(scifi.total).toBe(7_331);
      expect(scifi.parsedTags).toEqual(["科幻"]);
      expect(scifi.warnings).toEqual([]);

      const yuri = await searchSubjects(input({ tagExpr: "百合" }), client);
      expect(yuri.total).toBe(8_084);

      const both = await searchSubjects(input({ tagExpr: "科幻 & 百合" }), client);
      expect(both.total).toBeGreaterThan(0);
      expect(both.total).toBeLessThanOrEqual(7_331);
      expect(both.total).toBeLessThanOrEqual(8_084);
      // 交集应与 SubjectTag 直接统计一致。
      const groundTruth = await client.$queryRawUnsafe<CountRow[]>(
        [
          `SELECT COUNT(*) AS c FROM "Subject" s WHERE s."id" IN (`,
          `  SELECT st."subjectId" FROM "SubjectTag" st JOIN "Tag" t ON t."id" = st."tagId" WHERE t."nameLower" = ?`,
          `  INTERSECT`,
          `  SELECT st."subjectId" FROM "SubjectTag" st JOIN "Tag" t ON t."id" = st."tagId" WHERE t."nameLower" = ?`,
          `)`,
        ].join(" "),
        "科幻",
        "百合",
      );
      expect(both.total).toBe(Number(groundTruth[0]?.c ?? 0));
    });

    it("非法表达式 科幻 && → BAD_REQUEST（含位置提示，不是 500）", async () => {
      let caught: unknown;
      try {
        await searchSubjects(input({ tagExpr: "科幻 &&" }), client);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TRPCError);
      const trpcError = caught as TRPCError;
      expect(trpcError.code).toBe("BAD_REQUEST");
      expect(trpcError.message).toMatch(/第 \d+ 个字符/);
    });

    it("(科幻 | 奇幻) & !R18：结果都含 科幻/奇幻，且都不含 r18", async () => {
      const expression = "(科幻 | 奇幻) & !R18";
      const result = await searchSubjects(input({ tagExpr: expression }), client);

      expect(result.total).toBeGreaterThan(0);
      expect(result.items).toHaveLength(50);
      const ids = result.items.map((item) => item.id);
      const tagsById = await tagSetsOf(client, ids);

      for (const item of result.items) {
        const tags = tagsById.get(item.id);
        expect(tags, `subject ${item.id} 缺少标签集合`).toBeDefined();
        expect(
          tags!.has("科幻") || tags!.has("奇幻"),
          `subject ${item.id} 不含 科幻/奇幻`,
        ).toBe(true);
        expect(tags!.has("r18"), `subject ${item.id} 含 r18`).toBe(false);
      }

      // 卡片展示标签（最多 8 个）也不应出现 r18。
      for (const item of result.items) {
        expect(item.tags.map((tag) => tag.toLowerCase())).not.toContain("r18");
      }
    });

    it("yearFrom=2010 / yearTo=2020：所有结果 year ∈ [2010, 2020]", async () => {
      const result = await searchSubjects(
        input({ yearFrom: 2010, yearTo: 2020 }),
        client,
      );
      expect(result.total).toBeGreaterThan(0);
      const groundTruth = await client.subject.count({
        where: { year: { gte: 2010, lte: 2020 } },
      });
      expect(result.total).toBe(groundTruth);
      for (const item of result.items) {
        expect(item.year).not.toBeNull();
        expect(item.year!).toBeGreaterThanOrEqual(2010);
        expect(item.year!).toBeLessThanOrEqual(2020);
      }
    });

    it("types=[2]：所有结果 type=2，且 total=31,258", async () => {
      const result = await searchSubjects(input({ types: [2] }), client);
      expect(result.total).toBe(31_258);
      expect(result.items).toHaveLength(50);
      for (const item of result.items) {
        expect(item.type).toBe(2);
      }
    });

    it('q="攻壳"：total > 0（名称/中文名 LIKE）', async () => {
      const result = await searchSubjects(input({ q: "攻壳" }), client);
      expect(result.total).toBeGreaterThan(0);
      const groundTruth = await client.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*) AS c FROM "Subject" s WHERE s."name" LIKE ? OR s."nameCn" LIKE ?`,
        "%攻壳%",
        "%攻壳%",
      );
      expect(result.total).toBe(Number(groundTruth[0]?.c ?? 0));
    });

    it("分页：page=2 与 page=1 无重复 id；page=9999 按 totalPages 夹取", async () => {
      const page1 = await searchSubjects(input({ page: 1 }), client);
      const page2 = await searchSubjects(input({ page: 2 }), client);
      expect(page2.page).toBe(2);
      expect(page2.items).toHaveLength(50);
      const page1Ids = new Set(page1.items.map((item) => item.id));
      for (const item of page2.items) {
        expect(page1Ids.has(item.id)).toBe(false);
      }

      // 小结果集：科幻 & 百合 212 条 → 5 页；page=9999 应被夹到末页（第 5 页）。
      const clamped = await searchSubjects(
        input({ tagExpr: "科幻 & 百合", page: 9999 }),
        client,
      );
      expect(clamped.totalPages).toBe(
        Math.max(1, Math.ceil(clamped.total / clamped.pageSize)),
      );
      expect(clamped.totalPages).toBeLessThan(9999);
      expect(clamped.page).toBe(clamped.totalPages);
      expect(clamped.items).toHaveLength(
        clamped.total - (clamped.totalPages - 1) * clamped.pageSize,
      );

      // 默认搜索 totalPages=14,003 > 9,999，因此 page=9999 合法、不触发夹取。
      const deep = await searchSubjects(input({ page: 9999 }), client);
      expect(deep.totalPages).toBe(14_003);
      expect(deep.page).toBe(9999);
      expect(deep.items).toHaveLength(50);
    });

    it('scoreless="first"：首页全部 score=0，且 id 升序', async () => {
      const result = await searchSubjects(input({ scoreless: "first" }), client);
      expect(result.items).toHaveLength(50);
      expect(result.items.every((item) => item.score === 0)).toBe(true);
      for (let index = 1; index < result.items.length; index += 1) {
        expect(result.items[index]!.id).toBeGreaterThan(
          result.items[index - 1]!.id,
        );
      }
    });

    it("统计：total=700108、taggedTotal=422912、类型分布与数据报告一致", async () => {
      const stats = await getSubjectStats(client);
      expect(stats).toEqual({
        total: 700_108,
        taggedTotal: 422_912,
        types: [
          { type: 1, count: 422_971 },
          { type: 2, count: 31_258 },
          { type: 3, count: 101_230 },
          { type: 4, count: 117_881 },
          { type: 6, count: 26_768 },
        ],
      });
    });

    it("标签联想：q 过滤 + count 倒序 + limit", async () => {
      const scifi = await searchTags({ q: "科幻", limit: 5 }, client);
      expect(scifi.length).toBeGreaterThan(0);
      expect(scifi[0]).toEqual({ name: "科幻", count: 7_331 });
      for (const suggestion of scifi) {
        expect(suggestion.name.toLowerCase()).toContain("科幻");
      }
      for (let index = 1; index < scifi.length; index += 1) {
        expect(scifi[index]!.count).toBeLessThanOrEqual(scifi[index - 1]!.count);
      }

      const common = await searchTags({ q: "", limit: 20 }, client);
      expect(common).toHaveLength(20);
      expect(common[0]).toEqual({ name: "游戏", count: 107_540 });
      for (let index = 1; index < common.length; index += 1) {
        expect(common[index]!.count).toBeLessThanOrEqual(common[index - 1]!.count);
      }
    });

    it("router 接线：subject.search / tags / stats 均委托给 search 模块", async () => {
      const caller = createCaller({ db: client, headers: new Headers() });

      const stats = await caller.subject.stats();
      expect(stats.total).toBe(700_108);

      const search = await caller.subject.search({
        tagExpr: "科幻",
        q: "",
        sort: "score_desc",
        scoreless: "last",
        page: 1,
      });
      expect(search.total).toBe(7_331);
      expect(search.items).toHaveLength(50);

      const tags = await caller.subject.tags({ q: "科幻", limit: 5 });
      expect(tags[0]).toEqual({ name: "科幻", count: 7_331 });
    });

    it("真实查询耗时：默认搜索 / 科幻 & 年度 / 标签联想各 3 次取中位数", async () => {
      const RUNS = 3;
      const measure = async (run: () => Promise<unknown>): Promise<number> => {
        const samples: number[] = [];
        for (let index = 0; index < RUNS; index += 1) {
          const startedAt = performance.now();
          await run();
          samples.push(performance.now() - startedAt);
        }
        const value = median(samples);
        console.log(
          `[perf] ${samples.map((sample) => ms(sample)).join(" / ")} → 中位数 ${ms(value)}`,
        );
        return value;
      };

      console.log("[perf] 默认搜索（700,108 条，ORDER BY score）：");
      const defaultMs = await measure(() => searchSubjects(input(), client));

      console.log("[perf] 标签表达式「科幻 & 年度」：");
      const taggedMs = await measure(() =>
        searchSubjects(input({ tagExpr: "科幻 & 年度" }), client),
      );

      console.log("[perf] 「科幻」+ 2010–2020 年度过滤（年度语义的真实查询）：");
      const yearlyMs = await measure(() =>
        searchSubjects(
          input({ tagExpr: "科幻", yearFrom: 2010, yearTo: 2020 }),
          client,
        ),
      );

      console.log("[perf] 标签联想（q=科幻, limit=20）：");
      const tagSearchMs = await measure(() =>
        searchTags({ q: "科幻", limit: 20 }, client),
      );

      // 只做记录，不设硬阈值（CI 机器性能差异大）；保证数字被输出。
      expect([defaultMs, taggedMs, yearlyMs, tagSearchMs].every(Number.isFinite)).toBe(
        true,
      );
    });
  },
);
