import { DatabaseSync } from "node:sqlite";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileTagExpr, parseTagExpr, type TagExpr } from "~/server/tag-dsl";

/**
 * 编译器单测：用 node:sqlite 内存库建 Subject / Tag / SubjectTag fixture，
 * 实际执行编译产物，断言集合语义。
 *
 * fixture：
 *   1 科幻 百合
 *   2 科幻
 *   3 百合
 *   4 百合 R18
 *   5 C&C
 *   6 奇幻
 *   7 科幻 R18
 *   8 轻音 少女
 */
let db: DatabaseSync;

beforeAll(() => {
  db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE "Subject" ("id" INTEGER PRIMARY KEY);
    CREATE TABLE "Tag" (
      "id" INTEGER PRIMARY KEY,
      "name" TEXT NOT NULL,
      "nameLower" TEXT NOT NULL UNIQUE
    );
    CREATE TABLE "SubjectTag" (
      "subjectId" INTEGER NOT NULL,
      "tagId" INTEGER NOT NULL,
      PRIMARY KEY ("subjectId", "tagId")
    );
  `);
  const insertSubject = db.prepare(`INSERT INTO "Subject" ("id") VALUES (?)`);
  for (let id = 1; id <= 8; id += 1) insertSubject.run(id);

  const insertTag = db.prepare(
    `INSERT INTO "Tag" ("id", "name", "nameLower") VALUES (?, ?, ?)`,
  );
  const tags: [number, string][] = [
    [1, "科幻"],
    [2, "百合"],
    [3, "R18"],
    [4, "C&C"],
    [5, "奇幻"],
    [6, "轻音 少女"],
  ];
  for (const [id, name] of tags) insertTag.run(id, name, name.toLowerCase());

  const insertSubjectTag = db.prepare(
    `INSERT INTO "SubjectTag" ("subjectId", "tagId") VALUES (?, ?)`,
  );
  const links: [number, number][] = [
    [1, 1], [1, 2],
    [2, 1],
    [3, 2],
    [4, 2], [4, 3],
    [5, 4],
    [6, 5],
    [7, 1], [7, 3],
    [8, 6],
  ];
  for (const [subjectId, tagId] of links) insertSubjectTag.run(subjectId, tagId);
});

afterAll(() => {
  db.close();
});

function astOf(expression: string): TagExpr {
  const parsed = parseTagExpr(expression);
  if (!parsed.ok) {
    throw new Error(`fixture 表达式解析失败：${expression} — ${parsed.message}@${parsed.position}`);
  }
  return parsed.ast;
}

/** 执行编译产物，返回升序 subjectId。 */
function run(expression: string): number[] {
  const compiled = compileTagExpr(astOf(expression));
  const rows = db
    .prepare(`SELECT id FROM (${compiled.sql}) ORDER BY id`)
    .all(...compiled.params) as { id: number }[];
  return rows.map((row) => Number(row.id));
}

function compile(expression: string) {
  return compileTagExpr(astOf(expression));
}

describe("compiler · 基本集合语义", () => {
  it("单个标签（大小写不敏感，参数小写化）", () => {
    expect(run("科幻")).toEqual([1, 2, 7]);
    expect(run('"c&c"')).toEqual([5]);
    expect(run('"轻音 少女"')).toEqual([8]);
  });

  it("AND / INTERSECT", () => {
    expect(run("科幻 & 百合")).toEqual([1]);
    expect(run("科幻 & R18")).toEqual([7]);
    expect(run("科幻 & 科幻")).toEqual([1, 2, 7]);
  });

  it("OR / UNION 去重", () => {
    expect(run("科幻 | 百合")).toEqual([1, 2, 3, 4, 7]);
    expect(run("科幻 | 科幻")).toEqual([1, 2, 7]);
    expect(run("科幻 | 百合 | 奇幻")).toEqual([1, 2, 3, 4, 6, 7]);
  });

  it("NOT / EXCEPT", () => {
    expect(run("!科幻")).toEqual([3, 4, 5, 6, 8]);
    expect(run("~科幻")).toEqual([3, 4, 5, 6, 8]);
    expect(run("!(科幻 | 百合)")).toEqual([5, 6, 8]);
    expect(run("!(科幻 & 百合)")).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it("连续取反", () => {
    expect(run("!!科幻")).toEqual([1, 2, 7]);
    expect(run("!!!科幻")).toEqual([3, 4, 5, 6, 8]);
  });

  it("嵌套组合", () => {
    expect(run("科幻 & !R18")).toEqual([1, 2]);
    expect(run("(科幻 | 奇幻) & !R18")).toEqual([1, 2, 6]);
    expect(run("科幻 & (百合 | R18)")).toEqual([1, 7]);
    expect(run("(科幻 & 百合) | (奇幻 & !R18)")).toEqual([1, 6]);
    expect(run("!((科幻 | 百合) & !R18)")).toEqual([4, 5, 6, 7, 8]);
  });

  it("未知标签 → 空集；其取反 → 全集", () => {
    expect(run("不存在的标签")).toEqual([]);
    expect(run("科幻 & 不存在的标签")).toEqual([]);
    expect(run("!不存在的标签")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(run("不存在的标签 | 奇幻")).toEqual([6]);
  });

  it("空引号标签 → 空集", () => {
    expect(run('""')).toEqual([]);
  });

  it("all 节点编译为全量 Subject", () => {
    const compiled = compileTagExpr({ kind: "all" });
    expect(compiled.params).toEqual([]);
    const rows = db.prepare(`SELECT id FROM (${compiled.sql}) ORDER BY id`).all() as {
      id: number;
    }[];
    expect(rows.map((row) => Number(row.id))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("compiler · SQL 形态与参数顺序", () => {
  it("标签名只出现在参数里，绝不拼进 SQL", () => {
    const compiled = compile("科幻 & 百合");
    expect(compiled.sql).not.toContain("科幻");
    expect(compiled.sql).not.toContain("百合");
    expect(compiled.sql).toContain("?");
    expect(compiled.params).toEqual(["科幻", "百合"]);
  });

  it("参数顺序为 SQL 文本先左后右", () => {
    expect(compile("科幻 | (百合 & 奇幻)").params).toEqual(["科幻", "百合", "奇幻"]);
    // 参数统一按 nameLower 小写化，顺序与 SQL 文本一致（先左后右）。
    expect(compile("(科幻 & 百合) | (R18 & 奇幻)").params).toEqual([
      "科幻",
      "百合",
      "r18",
      "奇幻",
    ]);
    expect(compile("!科幻").params).toEqual(["科幻"]);
  });

  it("AND / OR 用 INTERSECT / UNION，NOT 用 EXCEPT，且子节点嵌套在 FROM 中", () => {
    expect(compile("科幻 & 百合").sql).toContain("INTERSECT");
    expect(compile("科幻 | 百合").sql).toContain("UNION");
    expect(compile("!科幻").sql).toContain("EXCEPT");
    expect(compile("科幻 & (百合 | 奇幻)").sql).toContain("SELECT id FROM (");
  });

  it("注入式标签名被参数化，不改变集合", () => {
    const compiled = compile('"x\\" OR 1=1 --"');
    expect(compiled.sql).not.toContain("1=1");
    expect(compiled.params).toEqual(['x" or 1=1 --']);
    const rows = db
      .prepare(`SELECT id FROM (${compiled.sql}) ORDER BY id`)
      .all(...compiled.params) as { id: number }[];
    expect(rows).toEqual([]);
    expect(db.prepare(`SELECT COUNT(*) AS c FROM "Subject"`).get()).toMatchObject({ c: 8 });
  });
});
