import { describe, expect, it } from "vitest";

import { formatCount, formatScore, formatYear } from "./format";

describe("formatCount", () => {
  it("一万以下用千分位", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(5)).toBe("5");
    expect(formatCount(9999)).toBe("9,999");
  });

  it("一万及以上用万", () => {
    expect(formatCount(10_000)).toBe("1万");
    expect(formatCount(12_345)).toBe("1.2万");
    expect(formatCount(123_456)).toBe("12.3万");
    expect(formatCount(1_000_000)).toBe("100万");
  });

  it("非法值回退 0", () => {
    expect(formatCount(Number.NaN)).toBe("0");
    expect(formatCount(-10)).toBe("0");
  });
});

describe("formatScore", () => {
  it("保留 1 位小数", () => {
    expect(formatScore(8.66)).toBe("8.7");
    expect(formatScore(8)).toBe("8.0");
    expect(formatScore(0.04)).toBe("0.0");
  });

  it("0 / 非法值为无评分", () => {
    expect(formatScore(0)).toBe("无评分");
    expect(formatScore(Number.NaN)).toBe("无评分");
    expect(formatScore(-1)).toBe("无评分");
  });
});

describe("formatYear", () => {
  it("优先原始日期，其次年份", () => {
    expect(formatYear(2002, "2002-10-01")).toBe("2002-10-01");
    expect(formatYear(2002, null)).toBe("2002");
    expect(formatYear(2002)).toBe("2002");
  });

  it("均缺失时为 —", () => {
    expect(formatYear(null, null)).toBe("—");
    expect(formatYear(null, "  ")).toBe("—");
  });
});
