import { describe, expect, it } from "vitest";

import type { CoverUrls } from "~/shared/subject-contract";

import { buildCoverCandidates, formatVotesRank } from "./preview";

const largeUrl = "https://lain.bgm.tv/pic/cover/l/aa/bb/1.jpg";

const urls: CoverUrls = {
  large: largeUrl,
  common: "https://lain.bgm.tv/pic/cover/l/aa/bb/1.jpg?r=400",
  small: "https://lain.bgm.tv/pic/cover/l/aa/bb/1.jpg?r=200",
  grid: "https://lain.bgm.tv/pic/cover/l/aa/bb/1.jpg?r=100",
};

describe("buildCoverCandidates", () => {
  it("按 large → common → small → grid 排序", () => {
    expect(buildCoverCandidates(urls)).toEqual([urls.large, urls.common, urls.small, urls.grid]);
  });

  it("large 为 null 时从 common 开始", () => {
    expect(buildCoverCandidates({ ...urls, large: null })).toEqual([urls.common, urls.small, urls.grid]);
  });

  it("无封面 / 数据未到返回空数组", () => {
    expect(buildCoverCandidates(null)).toEqual([]);
    expect(buildCoverCandidates(undefined)).toEqual([]);
  });

  it("去重并过滤空串", () => {
    expect(
      buildCoverCandidates({
        large: largeUrl,
        common: largeUrl,
        small: "  ",
        grid: urls.grid,
      }),
    ).toEqual([largeUrl, urls.grid]);
  });
});

describe("formatVotesRank", () => {
  it("人数 + 排名", () => {
    expect(formatVotesRank(12_345, 1933)).toBe("1.2万人评分 · 排名 #1933");
  });

  it("只有人数或只有排名", () => {
    expect(formatVotesRank(1234, null)).toBe("1,234人评分");
    expect(formatVotesRank(0, 88)).toBe("0人评分 · 排名 #88");
  });

  it("两者都缺失时为 —（rank 0 也视为缺失）", () => {
    expect(formatVotesRank(0, null)).toBe("—");
    expect(formatVotesRank(0, 0)).toBe("—");
    expect(formatVotesRank(Number.NaN, null)).toBe("—");
  });
});
