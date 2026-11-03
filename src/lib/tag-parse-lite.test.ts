import { describe, expect, it } from "vitest";

import { extractTagNames, getBareTagFragment, parseTagExpr } from "./tag-parse-lite";

describe("parseTagExpr 合法表达式", () => {
  it("空表达式 / 纯空白合法且无标签", () => {
    expect(parseTagExpr("")).toEqual({ ok: true, tags: [] });
    expect(parseTagExpr("   \u3000 ")).toEqual({ ok: true, tags: [] });
  });

  it("优先级与括号", () => {
    expect(parseTagExpr("科幻 & (恋爱 | 百合) & !R18")).toEqual({
      ok: true,
      tags: ["科幻", "恋爱", "百合", "R18"],
    });
    expect(parseTagExpr("!(科幻 | 百合) & ~~R18")).toMatchObject({ ok: true });
  });

  it("引号标签与转义", () => {
    const result = parseTagExpr('"C&C" | "D&D"');
    expect(result.ok).toBe(true);
    expect(result.tags).toEqual(["C&C", "D&D"]);

    const escaped = parseTagExpr('"a\\"b" & "c\\\\d"');
    expect(escaped.ok).toBe(true);
    expect(escaped.tags).toEqual(['a"b', "c\\d"]);
  });

  it("标签按大小写不敏感去重且保留首次写法", () => {
    expect(parseTagExpr("Galgame & galgame & GALGAME").tags).toEqual(["Galgame"]);
  });
});

describe("parseTagExpr 错误", () => {
  it("未闭合括号指向左括号", () => {
    const result = parseTagExpr("科幻 & (恋爱");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("缺少右括号");
    expect(result.position).toBe(5);
    expect(result.tags).toEqual(["科幻", "恋爱"]);
  });

  it("悬空运算符", () => {
    expect(parseTagExpr("科幻 &")).toMatchObject({
      ok: false,
      message: '运算符 "&" 缺少操作数',
      position: 3,
    });
    expect(parseTagExpr("| 科幻")).toMatchObject({
      ok: false,
      message: '运算符 "|" 缺少操作数',
      position: 0,
    });
    expect(parseTagExpr("科幻 &&")).toMatchObject({
      ok: false,
      message: '运算符 "&" 缺少操作数',
      position: 3,
    });
  });

  it("空括号", () => {
    expect(parseTagExpr("()")).toMatchObject({
      ok: false,
      message: "括号内缺少标签或表达式",
      position: 1,
    });
  });

  it("未闭合引号", () => {
    expect(parseTagExpr('科幻 & "C&C')).toMatchObject({
      ok: false,
      message: "引号未闭合",
      position: 5,
    });
  });

  it("多余的右括号 / 相邻标签缺少运算符", () => {
    expect(parseTagExpr("科幻)")).toMatchObject({
      ok: false,
      position: 2,
    });
    expect(parseTagExpr("科幻)").message).toContain("无法识别");
    expect(parseTagExpr("科幻 百合")).toMatchObject({
      ok: false,
      position: 3,
    });
    expect(parseTagExpr("科幻 百合").message).toContain("缺少运算符");
  });
});

describe("extractTagNames", () => {
  it("表达式非法时仍尽量提取标签", () => {
    expect(extractTagNames("科幻 & (恋爱")).toEqual(["科幻", "恋爱"]);
    expect(extractTagNames("科幻 &&")).toEqual(["科幻"]);
  });
});

describe("getBareTagFragment", () => {
  it("返回光标所在的裸标签片段", () => {
    expect(getBareTagFragment("科幻 & 恋", 7)).toEqual({ start: 5, end: 6, text: "恋" });
    expect(getBareTagFragment("科幻", 1)).toEqual({ start: 0, end: 2, text: "科幻" });
  });

  it("空白/运算符/引号内返回 null", () => {
    expect(getBareTagFragment("科幻 & 恋爱", 3)).toBeNull();
    expect(getBareTagFragment("科幻 &", 4)).toBeNull();
    expect(getBareTagFragment('"C&C"', 2)).toBeNull();
    expect(getBareTagFragment('"C&C"', 5)).toBeNull();
  });
});
