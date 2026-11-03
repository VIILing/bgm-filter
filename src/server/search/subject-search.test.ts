/**
 * `subject-search` 加权排序单测（临时 SQLite fixture，不触碰 dev.db）。
 *
 * - 贝叶斯公式纯函数；
 * - C（全局按人次加权平均分）的计算、Promise 缓存与失败回退；
 * - weighted / score_desc / score_asc / scoreless 四种排序在小型数据集上的顺序。
 */

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SearchInput } from "~/shared/subject-contract";
import {
  BAYESIAN_PRIOR_VOTES,
  FALLBACK_GLOBAL_MEAN_SCORE,
  bayesianWeightedScore,
  getGlobalMeanScore,
  searchSubjects,
} from "~/server/search/subject-search";
import { createTestDatabase, type TestDatabase } from "./test-fixture";

const C = 7.104_231_690_055_022;

const BASE_INPUT: SearchInput = {
  tagExpr: "",
  q: "",
  sort: "weighted_desc",
  scoreless: "last",
  page: 1,
};

function input(overrides: Partial<SearchInput> = {}): SearchInput {
  return { ...BASE_INPUT, ...overrides };
}

/** 1 人 10 分 / 高票高分 / 高票中分 / 无评分。 */
const FIXTURE_SUBJECTS = [
  { id: 1, type: 2, name: "一人十分", score: 10, scoreVotes: 1 },
  { id: 2, type: 2, name: "高票高分", score: 9.4, scoreVotes: 500 },
  { id: 3, type: 2, name: "高票中分", score: 9.0, scoreVotes: 1000 },
  { id: 4, type: 2, name: "无评分", score: 0, scoreVotes: 0 },
];

/** fixture 的 C = (10*1 + 9.4*500 + 9*1000) / (1 + 500 + 1000)。 */
const FIXTURE_C = 13_710 / 1_501;

describe("bayesianWeightedScore", () => {
  it("1 人 10 分被先验拉回 ~7.16，不再等于 10", () => {
    const value = bayesianWeightedScore(10, 1, C, BAYESIAN_PRIOR_VOTES);
    expect(value).toBeCloseTo(7.161, 3);
    expect(value).toBeLessThan(8);
  });

  it("高票条目接近原始分（9.4 / 7154 人 ≈ 9.384）", () => {
    expect(
      bayesianWeightedScore(9.4, 7_154, C, BAYESIAN_PRIOR_VOTES),
    ).toBeCloseTo(9.384, 3);
  });

  it("score=0 / votes=0 时公式退化为 C（该组由调用方单独分组）", () => {
    expect(bayesianWeightedScore(0, 0, C)).toBe(C);
  });

  it("默认先验强度 m=50", () => {
    expect(BAYESIAN_PRIOR_VOTES).toBe(50);
    expect(bayesianWeightedScore(10, 1, C)).toBe(
      bayesianWeightedScore(10, 1, C, 50),
    );
  });
});

describe("getGlobalMeanScore", () => {
  it("失败时回退 7.1，且失败不缓存（下次重试）", async () => {
    let calls = 0;
    const broken = {
      $queryRawUnsafe: async (): Promise<unknown> => {
        calls += 1;
        throw new Error("no such table: Subject");
      },
    } as unknown as PrismaClient;

    expect(await getGlobalMeanScore(broken)).toBe(FALLBACK_GLOBAL_MEAN_SCORE);
    expect(await getGlobalMeanScore(broken)).toBe(FALLBACK_GLOBAL_MEAN_SCORE);
    expect(calls).toBe(2);
  });

  it("SUM 为 null（空表）时回退 7.1", async () => {
    const empty = {
      $queryRawUnsafe: async (): Promise<unknown> => [{ c: null }],
    } as unknown as PrismaClient;
    expect(await getGlobalMeanScore(empty)).toBe(FALLBACK_GLOBAL_MEAN_SCORE);
  });

  it("并发首查只打一次 DB（Promise 缓存）", async () => {
    let calls = 0;
    const fake = {
      $queryRawUnsafe: async (): Promise<unknown> => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return [{ c: 7.5 }];
      },
    } as unknown as PrismaClient;

    const [first, second] = await Promise.all([
      getGlobalMeanScore(fake),
      getGlobalMeanScore(fake),
    ]);
    expect(first).toBe(7.5);
    expect(second).toBe(7.5);
    expect(calls).toBe(1);
  });
});

describe("searchSubjects 加权排序（fixture）", () => {
  let fixture: TestDatabase;
  let client: PrismaClient;

  beforeAll(() => {
    fixture = createTestDatabase(FIXTURE_SUBJECTS);
    client = new PrismaClient({ datasourceUrl: `file:${fixture.path}` });
  });

  afterAll(async () => {
    await client.$disconnect();
    fixture.cleanup();
  });

  it("C 由真实数据动态计算（非硬编码）", async () => {
    expect(await getGlobalMeanScore(client)).toBeCloseTo(FIXTURE_C, 12);
  });

  it("weighted_desc：1 人 10 分不登顶，weighted 单调不增，0 分置底", async () => {
    const result = await searchSubjects(input(), client);

    // B(9.376) > A(9.151) > C(9.006) > D(无评分)。
    expect(result.items.map((item) => item.id)).toEqual([2, 1, 3, 4]);
    expect(result.items[0]!.id).not.toBe(1);

    const weighted = result.items
      .slice(0, 3)
      .map((item) =>
        bayesianWeightedScore(item.score, item.scoreVotes, FIXTURE_C),
      );
    for (let index = 1; index < weighted.length; index += 1) {
      expect(weighted[index]!).toBeLessThanOrEqual(weighted[index - 1]!);
    }
    expect(result.items[3]!.score).toBe(0);
  });

  it("weighted_desc + scoreless=first：无评分置顶", async () => {
    const result = await searchSubjects(input({ scoreless: "first" }), client);
    expect(result.items.map((item) => item.id)).toEqual([4, 2, 1, 3]);
  });

  it("score_desc：原始评分降序（1 人 10 分重新登顶）", async () => {
    const result = await searchSubjects(input({ sort: "score_desc" }), client);
    expect(result.items.map((item) => item.id)).toEqual([1, 2, 3, 4]);
  });

  it("score_asc：原始评分升序，0 分仍置底", async () => {
    const result = await searchSubjects(input({ sort: "score_asc" }), client);
    expect(result.items.map((item) => item.id)).toEqual([3, 2, 1, 4]);
  });
});
