import { describe, expect, it } from "vitest";

import { formatTagForExpr, insertTag } from "./tag-insert";

describe("formatTagForExpr", () => {
  it("普通标签不加引号", () => {
    expect(formatTagForExpr("科幻")).toBe("科幻");
    expect(formatTagForExpr("K-ON")).toBe("K-ON");
  });

  it("含空白/元字符/引号时加引号并转义", () => {
    expect(formatTagForExpr("C&C")).toBe('"C&C"');
    expect(formatTagForExpr("K-ON!")).toBe('"K-ON!"');
    expect(formatTagForExpr("|Otome|")).toBe('"|Otome|"');
    expect(formatTagForExpr("a b")).toBe('"a b"');
    expect(formatTagForExpr('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});

describe("insertTag", () => {
  it("空表达式直接插入", () => {
    expect(insertTag("", 0, "科幻")).toEqual({ expr: "科幻", cursor: 2 });
  });

  it("已有标签后自动补 ` & `", () => {
    expect(insertTag("科幻", 2, "百合")).toEqual({ expr: "科幻 & 百合", cursor: 7 });
  });

  it("光标前是运算符时不重复补 &", () => {
    expect(insertTag("科幻 & ", 5, "百合")).toEqual({ expr: "科幻 & 百合", cursor: 7 });
    expect(insertTag("科幻 |", 4, "百合")).toEqual({ expr: "科幻 |百合", cursor: 6 });
  });

  it("光标位于标签中间时插入并补空格", () => {
    expect(insertTag("科幻 & R18", 2, "百合")).toEqual({
      expr: "科幻 & 百合 & R18",
      cursor: 7,
    });
  });

  it("需要时自动加引号", () => {
    expect(insertTag("", 0, "C&C")).toEqual({ expr: '"C&C"', cursor: 5 });
    expect(insertTag("科幻", 2, "C&C")).toEqual({ expr: '科幻 & "C&C"', cursor: 10 });
  });

  it("已存在同名标签（大小写不敏感）时不重复插入", () => {
    expect(insertTag("科幻 & 百合", 7, "科幻")).toEqual({ expr: "科幻 & 百合", cursor: 7 });
    expect(insertTag("Galgame", 7, "galgame")).toEqual({ expr: "Galgame", cursor: 7 });
    expect(insertTag('"C&C"', 5, "c&c")).toEqual({ expr: '"C&C"', cursor: 5 });
  });

  it("越界光标会被夹取", () => {
    expect(insertTag("科幻", 99, "百合")).toEqual({ expr: "科幻 & 百合", cursor: 7 });
    expect(insertTag("科幻", -3, "百合")).toMatchObject({ expr: "百合 科幻", cursor: 2 });
  });

  it("去掉光标前多余空白，避免双空格", () => {
    expect(insertTag("科幻   ", 5, "百合")).toEqual({ expr: "科幻 & 百合", cursor: 7 });
  });
});
