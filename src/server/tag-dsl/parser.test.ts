import { describe, expect, it } from "vitest";

import {
  parseTagExpr,
  type ParseResult,
  type ParseSuccess,
  type TagExpr,
} from "~/server/tag-dsl";

function ok(input: string): ParseSuccess {
  const result = parseTagExpr(input);
  if (!result.ok) {
    throw new Error(`期望解析成功，实际失败：${result.message} @${result.position}`);
  }
  return result;
}

function fail(input: string): Extract<ParseResult, { ok: false }> {
  const result = parseTagExpr(input);
  if (result.ok) {
    throw new Error(`期望解析失败，实际成功：${JSON.stringify(result.ast)}`);
  }
  return result;
}

const tag = (name: string): TagExpr => ({ kind: "tag", name });
const and = (left: TagExpr, right: TagExpr): TagExpr => ({ kind: "and", left, right });
const or = (left: TagExpr, right: TagExpr): TagExpr => ({ kind: "or", left, right });
const not = (expr: TagExpr): TagExpr => ({ kind: "not", expr });

describe("parser · 基础与优先级", () => {
  it("单个标签", () => {
    const result = ok("科幻");
    expect(result.ast).toEqual(tag("科幻"));
    expect(result.tags).toEqual(["科幻"]);
  });

  it("空表达式与纯空白 → all", () => {
    for (const input of ["", "   ", "\u3000", "\t\n \u3000 "]) {
      const result = ok(input);
      expect(result.ast).toEqual({ kind: "all" });
      expect(result.tags).toEqual([]);
    }
  });

  it("& 优先级高于 |", () => {
    expect(ok("科幻 | 恋爱 & 奇幻").ast).toEqual(
      or(tag("科幻"), and(tag("恋爱"), tag("奇幻"))),
    );
    expect(ok("科幻 & 恋爱 | 奇幻").ast).toEqual(
      or(and(tag("科幻"), tag("恋爱")), tag("奇幻")),
    );
  });

  it("! / ~ 优先级最高", () => {
    expect(ok("!科幻 & 恋爱").ast).toEqual(and(not(tag("科幻")), tag("恋爱")));
    expect(ok("~科幻 | 恋爱").ast).toEqual(or(not(tag("科幻")), tag("恋爱")));
    expect(ok("!科幻 | 恋爱 & 奇幻").ast).toEqual(
      or(not(tag("科幻")), and(tag("恋爱"), tag("奇幻"))),
    );
  });

  it("括号覆盖优先级", () => {
    expect(ok("(科幻 | 恋爱) & 奇幻").ast).toEqual(
      and(or(tag("科幻"), tag("恋爱")), tag("奇幻")),
    );
    expect(ok("科幻 & (恋爱 | 奇幻)").ast).toEqual(
      and(tag("科幻"), or(tag("恋爱"), tag("奇幻"))),
    );
  });

  it("冗余括号与连续取反", () => {
    expect(ok("((科幻))").ast).toEqual(tag("科幻"));
    expect(ok("!!科幻").ast).toEqual(not(not(tag("科幻"))));
    expect(ok("!!!科幻").ast).toEqual(not(not(not(tag("科幻")))));
    expect(ok("!~科幻").ast).toEqual(not(not(tag("科幻"))));
    expect(ok("~!科幻").ast).toEqual(not(not(tag("科幻"))));
  });

  it("无空白的运算符", () => {
    expect(ok("科幻&恋爱").ast).toEqual(and(tag("科幻"), tag("恋爱")));
    expect(ok("科幻|恋爱").ast).toEqual(or(tag("科幻"), tag("恋爱")));
    expect(ok("!(科幻|恋爱)").ast).toEqual(not(or(tag("科幻"), tag("恋爱"))));
  });

  it("全角空格与制表符仅作分隔", () => {
    expect(ok("科幻\u3000&\u3000恋爱").ast).toEqual(and(tag("科幻"), tag("恋爱")));
    expect(ok("\t科幻\n|\r恋爱 ").ast).toEqual(or(tag("科幻"), tag("恋爱")));
  });

  it("深层嵌套", () => {
    expect(ok("((科幻 & (恋爱 | 奇幻)) | !R18)").ast).toEqual(
      or(and(tag("科幻"), or(tag("恋爱"), tag("奇幻"))), not(tag("R18"))),
    );
  });
});

describe("parser · 引号与转义", () => {
  it("引号标签可含运算符/空白", () => {
    expect(ok('"C&C"').ast).toEqual(tag("C&C"));
    expect(ok('"|Otome|"').ast).toEqual(tag("|Otome|"));
    expect(ok('"K-ON!"').ast).toEqual(tag("K-ON!"));
    expect(ok('"轻音 少女"').ast).toEqual(tag("轻音 少女"));
    expect(ok('"a (b) | c & !d ~ e"').ast).toEqual(tag("a (b) | c & !d ~ e"));
  });

  it("引号内 \\\" 表示双引号", () => {
    expect(ok('"a\\"b"').ast).toEqual(tag('a"b'));
  });

  it("引号内 \\\\ 表示反斜杠", () => {
    expect(ok('"a\\\\b"').ast).toEqual(tag("a\\b"));
  });

  it("其它 \\x 视为 x", () => {
    expect(ok('"a\\zb"').ast).toEqual(tag("azb"));
    expect(ok('"\\科幻"').ast).toEqual(tag("科幻"));
  });

  it("引号标签参与布尔运算", () => {
    expect(ok('"C&C" | "D&D"').ast).toEqual(or(tag("C&C"), tag("D&D")));
    expect(ok('~"C&C" & 科幻').ast).toEqual(and(not(tag("C&C")), tag("科幻")));
  });

  it("空引号解析为空标签（不匹配任何标签，但不报语法错）", () => {
    expect(ok('""').ast).toEqual(tag(""));
  });
});

describe("parser · 标签列表与大小写", () => {
  it("tags 按首次出现顺序去重，保留原始写法", () => {
    expect(ok("科幻 & 恋爱 | 科幻").tags).toEqual(["科幻", "恋爱"]);
    expect(ok("Galgame & galgame").tags).toEqual(["Galgame"]);
    expect(ok('"C&C" | 科幻').tags).toEqual(["C&C", "科幻"]);
  });

  it("大小写不敏感去重但 AST 保留原文", () => {
    const result = ok("Galgame | galgame");
    expect(result.ast).toEqual(or(tag("Galgame"), tag("galgame")));
    expect(result.tags).toEqual(["Galgame"]);
  });
});

describe("parser · 错误信息与位置（0 基）", () => {
  it("未闭合括号：位置指向左括号", () => {
    const result = fail("科幻 & (恋爱");
    expect(result.message).toContain("缺少右括号");
    expect(result.position).toBe(5);

    const nested = fail("(科幻");
    expect(nested.message).toContain("缺少右括号");
    expect(nested.position).toBe(0);
  });

  it("空括号", () => {
    const result = fail("()");
    expect(result.message).toContain("缺少标签");
    expect(result.position).toBe(1);
  });

  it("悬空运算符缺少操作数", () => {
    expect(fail("科幻 &")).toMatchObject({ position: 3 });
    expect(fail("科幻 &").message).toContain("缺少操作数");
    expect(fail("| 科幻")).toMatchObject({ position: 0 });
    expect(fail("科幻 |")).toMatchObject({ position: 3 });
    expect(fail("科幻 &&")).toMatchObject({ position: 3 });
    expect(fail("科幻 &&").message).toContain('运算符 "&"');
    expect(fail("(&)")).toMatchObject({ position: 1 });
    expect(fail("科幻 & !")).toMatchObject({ position: 5 });
    expect(fail("科幻 | )")).toMatchObject({ position: 3 });
    expect(fail("!")).toMatchObject({ position: 0 });
  });

  it("无括号的取反后缺操作数", () => {
    const result = fail("科幻 & !");
    expect(result.message).toContain("缺少操作数");
  });

  it("未闭合引号：位置指向引号起点", () => {
    const result = fail('科幻 & "恋爱');
    expect(result.message).toContain("引号未闭合");
    expect(result.position).toBe(5);

    expect(fail('"')).toMatchObject({ position: 0 });
    // 结尾的反斜杠转义了引号，仍视为未闭合
    expect(fail('"abc\\"')).toMatchObject({ position: 0 });
  });

  it("多余右括号 → 无法识别的字符", () => {
    const result = fail("科幻)");
    expect(result.message).toContain("无法识别");
    expect(result.position).toBe(2);
    expect(fail(")")).toMatchObject({ position: 0 });
  });

  it("相邻标签缺少运算符", () => {
    const result = fail("科幻 恋爱");
    expect(result.message).toContain("缺少运算符");
    expect(result.position).toBe(3);
    expect(fail('"C&C" "D&D"')).toMatchObject({ position: 6 });
    expect(fail("(科幻 恋爱)")).toMatchObject({ position: 4 });
  });

  it("括号内悬空运算符", () => {
    expect(fail("(科幻 &)")).toMatchObject({ position: 4 });
    expect(fail("(科幻 &)").message).toContain("缺少操作数");
  });
});
