import { describe, expect, it } from "vitest";

import { COVER_IDS_MAX } from "~/shared/subject-contract";

import { chunkCoverIds, DEFAULT_COVER_CHUNK_SIZE } from "./cover-batch";

function range(count: number, start = 1): number[] {
  return Array.from({ length: count }, (_, index) => start + index);
}

describe("chunkCoverIds", () => {
  it("默认每 10 个一块并保持原顺序", () => {
    expect(DEFAULT_COVER_CHUNK_SIZE).toBe(10);
    expect(chunkCoverIds(range(25))).toEqual([
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
      [21, 22, 23, 24, 25],
    ]);
  });

  it("整页 50 个 id 切成 5 块，每块 10 个", () => {
    const chunks = chunkCoverIds(range(50));
    expect(chunks).toHaveLength(5);
    expect(chunks.every((chunk) => chunk.length === 10)).toBe(true);
    expect(chunks.flat()).toEqual(range(50));
  });

  it("去重并过滤非法 id，保留首次出现顺序", () => {
    const ids = [3, 1, 3, -1, 0, 2.5, Number.NaN, Number.POSITIVE_INFINITY, 2, 1];
    expect(chunkCoverIds(ids, 2)).toEqual([
      [3, 1],
      [2],
    ]);
  });

  it("空数组 / 全是非法 id 时返回空数组（不产生空块）", () => {
    expect(chunkCoverIds([])).toEqual([]);
    expect(chunkCoverIds([0, -5, 1.2, Number.NaN])).toEqual([]);
  });

  it("size 上限为 COVER_IDS_MAX", () => {
    const chunks = chunkCoverIds(range(COVER_IDS_MAX + 3), 999);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(COVER_IDS_MAX);
    expect(chunks[1]).toHaveLength(3);
  });

  it("size 非有限数回退默认值，非正数夹到 1", () => {
    expect(chunkCoverIds(range(3), Number.NaN)).toEqual([[1, 2, 3]]);
    expect(chunkCoverIds(range(3), 0)).toEqual([[1], [2], [3]]);
    expect(chunkCoverIds(range(3), -10)).toEqual([[1], [2], [3]]);
  });

  it("size 为小数时向下取整", () => {
    expect(chunkCoverIds(range(5), 2.9)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
