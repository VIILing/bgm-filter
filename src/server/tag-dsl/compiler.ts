/**
 * 标签 DSL → SQL 编译器（纯函数，无 IO）。
 *
 * 输出用于生成 **subjectId 集合** 的子查询，配合 `Subject."id" IN (<sql>)` 使用。
 * 设计要点（SQLite 复合 SELECT 语法）：
 *  - 每个节点输出一个自包含的 SELECT（列名统一为 `id`），既可独立执行，
 *    也可放进 `FROM (<select>)` / `IN (<select>)`；
 *  - AND / OR 的每个子节点都通过 `SELECT id FROM (<child>)` 嵌套后再参与
 *    INTERSECT / UNION，避免子节点本身是复合 SELECT 时被 SQLite 以错误优先级解析
 *    （SQLite 不允许给复合 SELECT 的操作数直接加括号）；
 *  - NOT 用「全量 Subject EXCEPT 内部集合」，内部集合同样包成
 *    `SELECT id FROM (<child>)`（简单 SELECT），保证 EXCEPT 的右操作数不是复合语句；
 *  - 标签名只通过 `?` 参数传入（nameLower 小写），绝不拼接进 SQL。
 */

import type { TagExpr } from "./parser";

export interface CompiledTagExpr {
  /** 返回 subjectId 集合的 SELECT（未加外层括号）。 */
  sql: string;
  /** `?` 占位符参数，顺序为 SQL 文本从左到右。 */
  params: string[];
}

const ALL_SUBJECTS_SQL = `SELECT s."id" AS id FROM "Subject" s`;

const TAG_SUBJECTS_SQL = [
  `SELECT st."subjectId" AS id`,
  `FROM "SubjectTag" st`,
  `JOIN "Tag" t ON t."id" = st."tagId"`,
  `WHERE t."nameLower" = ?`,
].join(" ");

function build(ast: TagExpr, params: string[]): string {
  switch (ast.kind) {
    case "all":
      return ALL_SUBJECTS_SQL;

    case "tag":
      // DSL 匹配大小写不敏感，统一按 nameLower 比较。
      params.push(ast.name.toLowerCase());
      return TAG_SUBJECTS_SQL;

    case "not": {
      const inner = build(ast.expr, params);
      return `SELECT s."id" AS id FROM "Subject" s EXCEPT SELECT id FROM (${inner})`;
    }

    case "and": {
      const left = build(ast.left, params);
      const right = build(ast.right, params);
      return `SELECT id FROM (${left}) INTERSECT SELECT id FROM (${right})`;
    }

    case "or": {
      const left = build(ast.left, params);
      const right = build(ast.right, params);
      return `SELECT id FROM (${left}) UNION SELECT id FROM (${right})`;
    }
  }
}

/**
 * 编译标签表达式 AST。
 *
 * 返回的 `sql` 可独立执行（`SELECT * FROM (<sql>)`），也可直接用于
 * `Subject."id" IN (<sql>)`；参数顺序与 SQL 文本中的 `?` 从左到右一致。
 */
export function compileTagExpr(ast: TagExpr): CompiledTagExpr {
  const params: string[] = [];
  const sql = build(ast, params);
  return { sql, params };
}
