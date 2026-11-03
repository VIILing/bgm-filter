import { describe, expect, it } from "vitest";

import { parsePreviewMetaTags, parsePreviewTags } from "./preview-utils";

describe("parsePreviewTags", () => {
  it("正常：解析 name/count 并按 count 降序", () => {
    const json = JSON.stringify([
      { name: "井上雄彦", count: 575 },
      { name: "篮球", count: 312 },
      { name: "SLAM DUNK", count: 90 },
    ]);
    expect(parsePreviewTags(json)).toEqual([
      { name: "井上雄彦", count: 575 },
      { name: "篮球", count: 312 },
      { name: "SLAM DUNK", count: 90 },
    ]);
  });

  it("输入乱序时按 count 降序重新排序", () => {
    const json = JSON.stringify([
      { name: "a", count: 1 },
      { name: "b", count: 99 },
      { name: "c", count: 10 },
    ]);
    expect(parsePreviewTags(json).map((tag) => tag.name)).toEqual(["b", "c", "a"]);
  });

  it("count 相同保持原顺序（稳定排序）", () => {
    const json = JSON.stringify([
      { name: "first", count: 5 },
      { name: "second", count: 5 },
      { name: "third", count: 9 },
    ]);
    expect(parsePreviewTags(json).map((tag) => tag.name)).toEqual([
      "third",
      "first",
      "second",
    ]);
  });

  it("空值 / 空数组 / 非法 JSON / 非数组 → 空数组", () => {
    expect(parsePreviewTags(null)).toEqual([]);
    expect(parsePreviewTags("")).toEqual([]);
    expect(parsePreviewTags("[]")).toEqual([]);
    expect(parsePreviewTags("{not json")).toEqual([]);
    expect(parsePreviewTags('{"name":"x","count":1}')).toEqual([]);
    expect(parsePreviewTags("null")).toEqual([]);
    expect(parsePreviewTags("123")).toEqual([]);
  });

  it("同名去重：大小写不敏感，保留首次出现的写法与计数", () => {
    const json = JSON.stringify([
      { name: "Switch", count: 10 },
      { name: "switch", count: 999 },
      { name: "SWITCH", count: 5 },
      { name: "switch ", count: 1 },
    ]);
    expect(parsePreviewTags(json)).toEqual([{ name: "Switch", count: 10 }]);
  });

  it("跳过缺字段 / 非对象 / 空名字，非法 count 归零", () => {
    const json = JSON.stringify([
      null,
      "tag",
      42,
      { count: 10 },
      { name: "" },
      { name: "   " },
      { name: 123, count: 4 },
      { name: "ok", count: "7" },
      { name: "bad-count", count: "abc" },
      { name: "negative", count: -3 },
      { name: "float", count: 3.9 },
    ]);
    expect(parsePreviewTags(json)).toEqual([
      { name: "ok", count: 7 },
      { name: "float", count: 3 },
      { name: "bad-count", count: 0 },
      { name: "negative", count: 0 },
    ]);
  });

  it("标签名首尾空白会被裁掉", () => {
    expect(parsePreviewTags(JSON.stringify([{ name: "  灌篮高手  ", count: 2 }]))).toEqual([
      { name: "灌篮高手", count: 2 },
    ]);
  });
});

describe("parsePreviewMetaTags", () => {
  it("正常：字符串数组去空白、保序", () => {
    expect(parsePreviewMetaTags(JSON.stringify(["漫画", " 体育 ", "篮球"]))).toEqual([
      "漫画",
      "体育",
      "篮球",
    ]);
  });

  it("大小写不敏感去重", () => {
    expect(parsePreviewMetaTags(JSON.stringify(["NS", "ns", "Switch", "switch"]))).toEqual([
      "NS",
      "Switch",
    ]);
  });

  it("空值 / 非法 JSON / 非数组 / 非字符串项 → 容错", () => {
    expect(parsePreviewMetaTags(null)).toEqual([]);
    expect(parsePreviewMetaTags("")).toEqual([]);
    expect(parsePreviewMetaTags("{oops")).toEqual([]);
    expect(parsePreviewMetaTags('{"a":1}')).toEqual([]);
    expect(parsePreviewMetaTags(JSON.stringify(["ok", 1, null, "", "  ", "fine"]))).toEqual([
      "ok",
      "fine",
    ]);
  });
});
