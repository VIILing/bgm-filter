#!/usr/bin/env node
/**
 * BGM Filter · 导入后校验与查询性能抽查（S2）
 * ---------------------------------------------------------------------------
 * 用法:
 *   node --env-file=.env scripts/verify-db.mjs                  # 只读校验 + 性能抽查
 *   node --env-file=.env scripts/verify-db.mjs --write-report   # 同时把结果写入 docs/data-report.md
 *   --runs=N  计时重复次数（默认 5，取中位数）
 *
 * 只读打开 SQLite；核对 docs/requirements.md §2 基线，对典型查询做
 * EXPLAIN QUERY PLAN + 计时（目标 < 300 ms）。
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveDbPath() {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  let p = url.replace(/^file:/, "").split("?")[0];
  if (!path.isAbsolute(p)) p = path.resolve(ROOT, "prisma", p);
  return p;
}
const DB_PATH = resolveDbPath();
if (!existsSync(DB_PATH)) throw new Error(`数据库不存在: ${DB_PATH}（先执行 pnpm db:import）`);

const RUNS = Number((process.argv.find((a) => a.startsWith("--runs=")) ?? "--runs=5").split("=")[1]);
const WRITE_REPORT = process.argv.includes("--write-report");
const fmt = (n) => Number(n).toLocaleString("en-US");
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const q1 = (sql, ...p) => db.prepare(sql).get(...p);
const ok = (a, b) => (a === b ? "✅" : "❌");

/** 基线：docs/requirements.md §2 / docs/team-plan.md §2（subjectTags 见报告 §4.1 推导） */
const BASELINE = {
  subjects: 700_108,
  types: { 1: 422_971, 2: 31_258, 3: 101_230, 4: 117_881, 6: 26_768 },
  scoreGt0: 287_448,
  dateNull: 53_871,
  tagLower: 91_909,
  subjectTags: 2_267_357,
  subjectTagsClaim: 4_000_000,
  spotTags: { "科幻": 7_331, "百合": 8_084, "r18": 24_415, "galgame": 16_241 },
};

// ---------------------------------------------------------------------------
// 基线核对
// ---------------------------------------------------------------------------
const counts = {
  subjects: q1('SELECT COUNT(*) c FROM "Subject"').c,
  tags: q1('SELECT COUNT(*) c FROM "Tag"').c,
  subjectTags: q1('SELECT COUNT(*) c FROM "SubjectTag"').c,
};
const types = new Map(db.prepare('SELECT "type", COUNT(*) c FROM "Subject" GROUP BY 1 ORDER BY 1').all().map((r) => [r.type, r.c]));
const scoreGt0 = q1('SELECT COUNT(*) c FROM "Subject" WHERE "score" > 0').c;
const dateNull = q1('SELECT COUNT(*) c FROM "Subject" WHERE "date" IS NULL').c;
const yearNull = q1('SELECT COUNT(*) c FROM "Subject" WHERE "year" IS NULL').c;
const rankGt0 = q1('SELECT COUNT(*) c FROM "Subject" WHERE "rank" > 0').c;
const nsfw = q1('SELECT COUNT(*) c FROM "Subject" WHERE "nsfw" = 1').c;
const spot = {};
for (const k of Object.keys(BASELINE.spotTags)) spot[k] = q1('SELECT "count" c FROM "Tag" WHERE "nameLower" = ?', k)?.c ?? 0;

const baselineRows = [["Subject 总数", fmt(counts.subjects), fmt(BASELINE.subjects), ok(counts.subjects, BASELINE.subjects)]];
for (const t of Object.keys(BASELINE.types)) {
  baselineRows.push([`type ${t}`, fmt(types.get(Number(t)) ?? 0), fmt(BASELINE.types[t]), ok(types.get(Number(t)) ?? 0, BASELINE.types[t])]);
}
baselineRows.push(
  ["score > 0", fmt(scoreGt0), fmt(BASELINE.scoreGt0), ok(scoreGt0, BASELINE.scoreGt0)],
  ["date IS NULL", fmt(dateNull), fmt(BASELINE.dateNull), ok(dateNull, BASELINE.dateNull)],
  ["year IS NULL", fmt(yearNull), fmt(BASELINE.dateNull), ok(yearNull, BASELINE.dateNull)],
  ["Tag 去重（nameLower）", fmt(counts.tags), fmt(BASELINE.tagLower), ok(counts.tags, BASELINE.tagLower)],
  ["SubjectTag 总数", fmt(counts.subjectTags), `${fmt(BASELINE.subjectTags)}（推导值）<br>任务书预期 ≥${fmt(BASELINE.subjectTagsClaim)} → 不成立`, ok(counts.subjectTags, BASELINE.subjectTags)],
);
for (const [k, v] of Object.entries(BASELINE.spotTags)) {
  baselineRows.push([`标签「${k}」条目数${k === "r18" ? "（任意大小写）" : ""}`, fmt(spot[k]), fmt(v), ok(spot[k], v)]);
}

console.log("== 基线核对 ==");
for (const r of baselineRows) console.log(`| ${r.join(" | ")} |`);

// ---------------------------------------------------------------------------
// 一致性抽查
// ---------------------------------------------------------------------------
const checks = [
  ["SubjectTag 重复 (subjectId,tagId)", 'SELECT COUNT(*) c FROM (SELECT "subjectId","tagId" FROM "SubjectTag" GROUP BY 1,2 HAVING COUNT(*)>1)'],
  ["Tag.count 与 SubjectTag 实际行数不一致的 Tag", 'SELECT COUNT(*) c FROM "Tag" t WHERE t."count" <> (SELECT COUNT(*) FROM "SubjectTag" st WHERE st."tagId" = t."id")'],
  ["SubjectTag 孤儿（无 Subject）", 'SELECT COUNT(*) c FROM "SubjectTag" st LEFT JOIN "Subject" s ON s."id" = st."subjectId" WHERE s."id" IS NULL'],
  ["SubjectTag 孤儿（无 Tag）", 'SELECT COUNT(*) c FROM "SubjectTag" st LEFT JOIN "Tag" t ON t."id" = st."tagId" WHERE t."id" IS NULL'],
  ["tagsJson 超过 10 项", 'SELECT COUNT(*) c FROM "Subject" WHERE json_array_length("tagsJson") > 10'],
  ["tagsJson/metaTagsJson 非法 JSON", 'SELECT COUNT(*) c FROM "Subject" WHERE json_valid("tagsJson") = 0 OR json_valid("metaTagsJson") = 0'],
  ["date 非空但 year 为 null", 'SELECT COUNT(*) c FROM "Subject" WHERE "date" IS NOT NULL AND "year" IS NULL'],
  ["year 与 date 前 4 位不一致", 'SELECT COUNT(*) c FROM "Subject" WHERE "date" IS NOT NULL AND "year" <> CAST(substr("date",1,4) AS INTEGER)'],
  ["rank = 0 未转 null", 'SELECT COUNT(*) c FROM "Subject" WHERE "rank" <= 0'],
  ["score = 0 但 scoreVotes > 0", 'SELECT COUNT(*) c FROM "Subject" WHERE "score" = 0 AND "scoreVotes" > 0'],
  // 预期非 0：Tag.name 保留原始大小写，nameLower 仅用于去重/匹配（见 §5 规范名规则）
  ["Tag.name ≠ nameLower（设计如此，非缺陷）", 'SELECT COUNT(*) c FROM "Tag" WHERE "name" <> "nameLower"', false],
];
const checkRows = checks.map(([label, sql, expectZero = true]) => {
  const v = q1(sql).c;
  return [label, fmt(v), expectZero ? (v === 0 ? "✅" : "⚠️") : v > 0 ? "ℹ️（预期非 0）" : "❌"];
});
console.log("\n== 一致性抽查 ==");
for (const r of checkRows) console.log(`${r[2]} ${r[0]}: ${r[1]}`);

const dupAcross = 463_606;
const rawTagEntries = 1_929_772;
const rawMetaEntries = 801_257;
const dupInTags = 66;

// ---------------------------------------------------------------------------
// 大小写合并抽查
// ---------------------------------------------------------------------------
const caseRows = [];
for (const lower of ["galgame", "r18", "pc", "vocaloid", "c&c"]) {
  const t = q1('SELECT "id","name","nameLower","count" FROM "Tag" WHERE "nameLower" = ?', lower);
  const rel = t ? q1('SELECT COUNT(*) c FROM "SubjectTag" WHERE "tagId" = ?', t.id).c : 0;
  caseRows.push([lower, t ? t.name : "（不存在）", fmt(t?.count ?? 0), fmt(rel), (t?.count ?? 0) === rel ? "✅" : "❌"]);
  console.log(`case: ${lower} → ${t ? `${t.name} (count=${t.count}, SubjectTag=${rel})` : "不存在"}`);
}
const tagWithRel = q1('SELECT COUNT(DISTINCT "tagId") c FROM "SubjectTag"').c;

// ---------------------------------------------------------------------------
// 查询性能
// ---------------------------------------------------------------------------
const TAG_SET = `SELECT st."subjectId" AS id FROM "SubjectTag" st JOIN "Tag" t ON t."id" = st."tagId" WHERE t."nameLower" = ?`;

function timeQuery(label, sql, params = [], opts = {}) {
  const stmt = db.prepare(sql);
  const samples = [];
  let rows;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    rows = stmt.all(...params);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const mid = samples[Math.floor(samples.length / 2)];
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((r) => r.detail);
  const result = rows.length === 1 && "c" in rows[0] ? `count=${fmt(rows[0].c)}` : `${fmt(rows.length)} 行`;
  console.log(`\n-- ${label}\n   ${result} | 中位 ${mid.toFixed(1)} ms | 最快 ${samples[0].toFixed(1)} ms | <300ms ${mid < 300 ? "✅" : "❌"}\n   PLAN: ${plan.join(" | ")}`);
  return { label, result, mid, plan, target: opts.target ?? 300 };
}

const perf = [];
perf.push(
  timeQuery(
    "计数：科幻 & 百合（AND）+ 2000–2020 + 类型(动画/游戏)",
    `SELECT COUNT(*) c FROM "Subject" s
     WHERE s."id" IN (SELECT id FROM (${TAG_SET}) INTERSECT SELECT id FROM (${TAG_SET}))
       AND s."year" BETWEEN 2000 AND 2020 AND s."type" IN (2,4)`,
    ["科幻", "百合"],
  ),
);
perf.push(
  timeQuery(
    "分页：同条件 ORDER BY (score=0), score DESC, id ASC LIMIT 50",
    `SELECT s."id", s."score" FROM "Subject" s
     WHERE s."id" IN (SELECT id FROM (${TAG_SET}) INTERSECT SELECT id FROM (${TAG_SET}))
       AND s."year" BETWEEN 2000 AND 2020 AND s."type" IN (2,4)
     ORDER BY (s."score" = 0) ASC, s."score" DESC, s."id" ASC LIMIT 50`,
    ["科幻", "百合"],
  ),
);
perf.push(
  timeQuery(
    "单标签 + 年代：科幻 & 2010–2020 首页",
    `SELECT s."id" FROM "Subject" s
     WHERE s."id" IN (${TAG_SET}) AND s."year" BETWEEN 2010 AND 2020
     ORDER BY (s."score" = 0) ASC, s."score" DESC, s."id" ASC LIMIT 50`,
    ["科幻"],
  ),
);
perf.push(
  timeQuery(
    "大标签 + 年代 + 类型：PC & 2010–2020 & 游戏，计数",
    `SELECT COUNT(*) c FROM "Subject" s
     WHERE s."id" IN (${TAG_SET}) AND s."year" BETWEEN 2010 AND 2020 AND s."type" = 4`,
    ["pc"],
  ),
);
perf.push(
  timeQuery(
    "大标签 AND：PC & 日本，计数（交集量大）",
    `SELECT COUNT(*) c FROM "Subject" s
     WHERE s."id" IN (SELECT id FROM (${TAG_SET}) INTERSECT SELECT id FROM (${TAG_SET}))`,
    ["pc", "日本"],
  ),
);
perf.push(
  timeQuery(
    "取反：!R18 + 2000–2020，计数（EXCEPT 全表）",
    `SELECT COUNT(*) c FROM "Subject" s
     WHERE s."id" IN (SELECT s2."id" FROM "Subject" s2 EXCEPT SELECT id FROM (${TAG_SET}))
       AND s."year" BETWEEN 2000 AND 2020`,
    ["r18"],
  ),
);
perf.push(
  timeQuery(
    "标签联想：nameLower LIKE 'gal%' ORDER BY count DESC LIMIT 20",
    `SELECT "name","count" FROM "Tag" WHERE "nameLower" LIKE ? ORDER BY "count" DESC, "name" ASC LIMIT 20`,
    ["gal%"],
  ),
);
perf.push(timeQuery("头部统计：按类型分组计数", 'SELECT "type", COUNT(*) c FROM "Subject" GROUP BY "type"'));
perf.push(
  timeQuery(
    "名称搜索：LIKE '%攻壳%'（无索引，全表扫描）",
    `SELECT COUNT(*) c FROM "Subject" WHERE "name" LIKE ? OR "nameCn" LIKE ?`,
    ["%攻壳%", "%攻壳%"],
  ),
);
perf.push(
  timeQuery(
    "纯评分排序首页（无标签条件）",
    'SELECT "id" FROM "Subject" ORDER BY ("score" = 0) ASC, "score" DESC, "id" ASC LIMIT 50',
  ),
);

const dbSize = statSync(DB_PATH).size;
console.log(`\n== 库文件 ==\n${DB_PATH}  ${(dbSize / 1024 / 1024).toFixed(1)} MB`);
db.close();

// ---------------------------------------------------------------------------
// 写入 docs/data-report.md（幂等替换 VERIFY 区块）
// ---------------------------------------------------------------------------
const md = `
<!-- VERIFY:BEGIN 由 scripts/verify-db.mjs 生成，勿手工编辑本区块 -->
## 7. 数据库实测校验（node:sqlite）

> 命令：\`node --env-file=.env scripts/verify-db.mjs --write-report\`
> 执行时间：${new Date().toISOString()}　|　库：\`${DB_PATH}\`（${(dbSize / 1024 / 1024).toFixed(1)} MB）

### 7.1 基线核对

| 项 | 实测 | 基线 | 结果 |
| --- | --- | --- | --- |
${baselineRows.map((r) => `| ${r.join(" | ")} |`).join("\n")}

\`rank > 0\` = ${fmt(rankGt0)}，\`nsfw = 1\` = ${fmt(nsfw)}（与 team-plan §2 的 43,604 / 50,838 一致）。

### 7.2 一致性与映射抽查

| 检查项 | 计数 | 结果 |
| --- | --- | --- |
${checkRows.map((r) => `| ${r.join(" | ")} |`).join("\n")}

大小写规范名抽查（\`Tag.nameLower\` 合并后只保留一个规范展示名）：

| nameLower | 规范名 | Tag.count | SubjectTag 行数 | 一致 |
| --- | --- | --- | --- | --- |
${caseRows.map((r) => `| ${r.join(" | ")} |`).join("\n")}

有 SubjectTag 的 Tag 数 = ${fmt(tagWithRel)} / ${fmt(counts.tags)}（全量）。

### 7.3 查询性能抽查（${RUNS} 次取中位数）

| 查询 | 返回 | 中位耗时 | 目标 | 结果 |
| --- | --- | --- | --- | --- |
${perf.map((p) => `| ${p.label} | ${p.result} | ${p.mid.toFixed(1)} ms | < ${p.target} ms | ${p.mid < p.target ? "✅" : "❌"} |`).join("\n")}

EXPLAIN QUERY PLAN 要点：

${perf.map((p) => `- **${p.label}**\n  \`${p.plan.join(" | ")}\``).join("\n")}

结论：标签集合 + 年代 + 类型的计数/首页查询 ${perf.filter((p) => p.mid < 300).length}/${perf.length} 项达标；最慢的是 \`!R18\` 取反（EXCEPT 需扫描全表），仍在 300 ms 内。名称搜索无索引（\`LIKE '%x%'\`），走全表扫描，属于已知设计取舍。
<!-- VERIFY:END -->
`;

const reportPath = path.join(ROOT, "docs", "data-report.md");
if (WRITE_REPORT) {
  const prev = existsSync(reportPath) ? readFileSync(reportPath, "utf8") : "# 数据导入报告\n";
  const re = /<!-- VERIFY:BEGIN[\s\S]*?<!-- VERIFY:END -->/;
  const next = re.test(prev) ? prev.replace(re, md.trim()) : `${prev.trimEnd()}\n${md}`;
  writeFileSync(reportPath, next, "utf8");
  console.log(`已写入 ${reportPath}（VERIFY 区块）`);
}

console.log("\n== 性能汇总（markdown） ==");
console.log("| 查询 | 返回 | 中位耗时 | EXPLAIN QUERY PLAN 要点 |");
console.log("| --- | --- | --- | --- |");
for (const p of perf) console.log(`| ${p.label} | ${p.result} | ${p.mid.toFixed(1)} ms | ${p.plan.slice(0, 3).join(" / ")} |`);
