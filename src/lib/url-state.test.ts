import { describe, expect, it } from "vitest";

import {
  ALL_TYPE_VALUES,
  createDefaultFilterState,
  isAllTypes,
  normalizeTypes,
  parseFilterState,
  toSearchParams,
} from "./url-state";

describe("parseFilterState", () => {
  it("空参数返回默认值", () => {
    expect(parseFilterState(new URLSearchParams())).toEqual({
      tagExpr: "",
      q: "",
      types: [...ALL_TYPE_VALUES],
      yearFrom: null,
      yearTo: null,
      sort: "score_desc",
      scoreless: "last",
      page: 1,
    });
  });

  it("支持 App Router 的字符串记录形式", () => {
    const state = parseFilterState({
      tag: "科幻 & (恋爱 | 百合)",
      q: "攻壳",
      types: "1,2",
      from: "1990",
      to: "2005",
      sort: "score_asc",
      scoreless: "first",
      page: "2",
    });
    expect(state).toEqual({
      tagExpr: "科幻 & (恋爱 | 百合)",
      q: "攻壳",
      types: [1, 2],
      yearFrom: 1990,
      yearTo: 2005,
      sort: "score_asc",
      scoreless: "first",
      page: 2,
    });
  });

  it("types 只保留合法值并按固定顺序排列", () => {
    expect(parseFilterState({ types: "6, 2,9,abc,2" }).types).toEqual([2, 6]);
    expect(parseFilterState({ types: "" }).types).toEqual([...ALL_TYPE_VALUES]);
    expect(parseFilterState({ types: "1,2,3,4,6" }).types).toEqual([...ALL_TYPE_VALUES]);
  });

  it("非法 from/to/sort/scoreless/page 回退默认值", () => {
    const state = parseFilterState({
      from: "abc",
      to: "999",
      sort: "unknown",
      scoreless: "middle",
      page: "0",
    });
    expect(state.yearFrom).toBeNull();
    expect(state.yearTo).toBeNull();
    expect(state.sort).toBe("score_desc");
    expect(state.scoreless).toBe("last");
    expect(state.page).toBe(1);
  });

  it("边界年份 1000 / 2100 合法，越界回退", () => {
    expect(parseFilterState({ from: "1000", to: "2100" })).toMatchObject({
      yearFrom: 1000,
      yearTo: 2100,
    });
    expect(parseFilterState({ from: "2101", to: "0999" })).toMatchObject({
      yearFrom: null,
      yearTo: null,
    });
  });

  it("裁剪首尾空白并截断超长 tag/q", () => {
    const state = parseFilterState({ tag: " 科幻 ", q: " x ".repeat(80) });
    expect(state.tagExpr).toBe("科幻");
    expect(state.q).toHaveLength(100);
  });
});

describe("toSearchParams", () => {
  it("默认值全部省略", () => {
    expect(toSearchParams(createDefaultFilterState()).toString()).toBe("");
  });

  it("按契约顺序写入非默认值", () => {
    const params = toSearchParams({
      tagExpr: "科幻",
      q: "攻壳",
      types: [2],
      yearFrom: 1990,
      yearTo: 2005,
      sort: "score_asc",
      scoreless: "first",
      page: 3,
    });
    expect(params.toString()).toBe(
      "tag=%E7%A7%91%E5%B9%BB&q=%E6%94%BB%E5%A3%B3&types=2&from=1990&to=2005&sort=score_asc&scoreless=first&page=3",
    );
  });

  it("全选 types 与空数组都省略", () => {
    expect(toSearchParams({ ...createDefaultFilterState(), types: [...ALL_TYPE_VALUES] }).has("types")).toBe(false);
    expect(toSearchParams({ ...createDefaultFilterState(), types: [] }).has("types")).toBe(false);
  });

  it("往返一致", () => {
    const state = parseFilterState({
      tag: '"C&C" | 科幻',
      q: "攻壳",
      types: "3,6",
      from: "2000",
      to: "2010",
      sort: "score_asc",
      scoreless: "first",
      page: "7",
    });
    expect(parseFilterState(toSearchParams(state))).toEqual(state);
  });
});

describe("types helpers", () => {
  it("normalizeTypes 全选/空 → 全选，未知值忽略", () => {
    expect(normalizeTypes([])).toEqual([...ALL_TYPE_VALUES]);
    expect(normalizeTypes([99])).toEqual([...ALL_TYPE_VALUES]);
    expect(normalizeTypes([6, 1, 6])).toEqual([1, 6]);
  });

  it("isAllTypes", () => {
    expect(isAllTypes(ALL_TYPE_VALUES)).toBe(true);
    expect(isAllTypes([])).toBe(true);
    expect(isAllTypes([1, 2])).toBe(false);
  });
});
