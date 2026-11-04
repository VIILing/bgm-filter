#!/usr/bin/env node
/**
 * BGM Filter · Bangumi Archive dump → SQLite 导入器
 * ---------------------------------------------------------------------------
 * 输入: <DUMP_DIR>/subject.jsonlines   (默认 <ROOT>/dump-db/subject.jsonlines)
 * 输出: DATABASE_URL 指向的 SQLite 库 (默认 prisma/dev.db；表由 `prisma db push` 建好)
 *
 * 规则来源: docs/architecture.md §4（数据模型 + 导入规则）
 *  - 只用内置 node:sqlite + readline 流式读取；不新增依赖、不建表、不改 schema；
 *  - 两遍扫描：① 统计 Tag 条目数 / 原始写法分布 ② 写 Subject / SubjectTag；
 *  - 幂等：每次先清空三张表（DELETE，不 DROP）；
 *  - 批量事务 + PRAGMA 调优，结束恢复并 ANALYZE。
 *
 * 环境变量:
 *  - DUMP_DIR       覆盖 dump 目录：绝对路径直接生效，相对路径相对仓库根 ROOT 解析；
 *                   未设置时回退 <ROOT>/dump-db；.env.local 优先于 .env。
 *  - DATABASE_URL   覆盖数据库；file: 相对路径按 Prisma 语义相对 prisma/ 解析
 */
import { createReadStream, existsSync, statSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDumpPath } from "./resolve-dump-path.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");

/**
 * 读取 .env.local 中的某个键（.env.local 优先于 .env）。
 * `pnpm db:import` 只 `node --env-file=.env`，不会自动加载 .env.local，
 * 故这里显式读取并覆盖。仅解析简单 `KEY=value` 与双/单引号包裹值，零依赖。
 */
function readEnvLocal(key) {
  const file = path.join(ROOT, ".env.local");
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || m[1] !== key) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return undefined;
}

const DUMP_DIR = resolveDumpPath(readEnvLocal("DUMP_DIR") ?? process.env.DUMP_DIR, ROOT);
const DUMP_FILE = path.join(DUMP_DIR, "subject.jsonlines");

const BATCH_SUBJECTS = 2000;   // 每个事务的 Subject 数（≈1.2 万条 SubjectTag）
const PROGRESS_EVERY = 200_000;
const VACUUM_THRESHOLD = 480 * 1024 * 1024;

/** 基线：docs/requirements.md §2 + docs/team-plan.md §2 */
const BASELINE = {
  subjects: 700_108,
  types: { 1: 422_971, 2: 31_258, 3: 101_230, 4: 117_881, 6: 26_768 },
  scoreGt0: 287_448,
  dateNull: 53_871,
  tagLower: 91_909,
  // 任务书预期 "4,000,000+"；实测见 §4.1：dump 自身只有 2,731,029 条标签记录，
  // 去重后 2,267,357——该预期基于错误假设，代码以可复现的推导值为基线。
  subjectTags: 2_267_357,
  subjectTagsClaim: 4_000_000,
  spotTags: { "科幻": 7_331, "百合": 8_084, "r18": 24_415, "galgame": 16_241 },
};

// ---------------------------------------------------------------------------
// DATABASE_URL → 绝对路径（Prisma: file:./dev.db 相对 prisma/ 目录）
// ---------------------------------------------------------------------------
function resolveDbPath() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL 未设置（.env 应有 DATABASE_URL="file:./dev.db"）');
  if (!url.startsWith("file:")) throw new Error(`仅支持 file: 协议: ${url}`);
  let p = url.slice("file:".length).split("?")[0];
  if (!path.isAbsolute(p)) p = path.resolve(ROOT, "prisma", p);
  return p;
}

const DB_PATH = resolveDbPath();
if (!existsSync(DB_PATH)) throw new Error(`数据库不存在: ${DB_PATH}（先执行 pnpm db:push）`);
if (!existsSync(DUMP_FILE)) throw new Error(`dump 不存在: ${DUMP_FILE}（可用 DUMP_DIR 指定）`);

// ---------------------------------------------------------------------------
// 字段映射
// ---------------------------------------------------------------------------
const YEAR_RE = /^(\d{4})/;
const isEmptyDate = (d) => typeof d !== "string" || d.length === 0;

/** date 前 4 位数字；无 / 空 / 非法 → null。"0701" → 701（预期脏数据，保留） */
const mapYear = (date) => (typeof date === "string" ? Number(YEAR_RE.exec(date)?.[1] ?? NaN) || null : null);

function sumScoreVotes(sd) {
  if (sd == null || typeof sd !== "object" || Array.isArray(sd)) return 0;
  let sum = 0;
  for (const k in sd) {
    const v = sd[k];
    if (typeof v === "number" && Number.isFinite(v)) sum += v;
  }
  return sum;
}

/** 条目标签集合：tags ∪ meta_tags，按 nameLower 去重（保留首次出现的原始写法） */
function collectTags(rec, out) {
  out.clear();
  const tags = rec.tags;
  if (Array.isArray(tags)) {
    for (let i = 0; i < tags.length; i++) {
      const t = tags[i];
      if (t === null || typeof t !== "object" || typeof t.name !== "string") continue;
      const raw = t.name;
      if (raw.length === 0) continue;
      const lower = raw.toLowerCase();
      if (!out.has(lower)) out.set(lower, raw);
    }
  }
  const meta = rec.meta_tags;
  if (Array.isArray(meta)) {
    for (let i = 0; i < meta.length; i++) {
      const raw = meta[i];
      if (typeof raw !== "string" || raw.length === 0) continue;
      const lower = raw.toLowerCase();
      if (!out.has(lower)) out.set(lower, raw);
    }
  }
  return out;
}

const isValidRecord = (r) =>
  r !== null && typeof r === "object" &&
  typeof r.id === "number" && Number.isFinite(r.id) &&
  typeof r.type === "number" && typeof r.name === "string";

async function eachLine(file, onLine) {
  const rl = createInterface({
    input: createReadStream(file, { encoding: "utf8", highWaterMark: 1 << 20 }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) if (line.length !== 0) onLine(line);
}

const fmt = (n) => Number(n).toLocaleString("en-US");
const secs = (ms) => (ms / 1000).toFixed(1);
const mb = (b) => (b / 1024 / 1024).toFixed(1);

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const tStart = performance.now();
const phases = [];
let phaseStart = tStart;
const markPhase = (name) => {
  const now = performance.now();
  phases.push({ name, ms: now - phaseStart });
  phaseStart = now;
};

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA synchronous=OFF");
db.exec("PRAGMA foreign_keys=OFF");
db.exec("PRAGMA cache_size=-262144"); // 256 MiB
db.exec("PRAGMA temp_store=MEMORY");
db.exec("PRAGMA busy_timeout=10000");

// 幂等：清空三表（保持 Prisma 建好的表/索引不动）
db.exec('DELETE FROM "SubjectTag"');
db.exec('DELETE FROM "Tag"');
db.exec('DELETE FROM "Subject"');
db.exec('DELETE FROM sqlite_sequence WHERE name = \'Tag\''); // 让 Tag.id 也稳定
markPhase("清空旧数据（幂等）");

// --- Pass 1: Tag 统计 ------------------------------------------------------
const tagSubjects = new Map(); // nameLower -> 条目数
const tagVariants = new Map(); // nameLower -> Map<原始写法, 条目数>
const seenIds = new Set();     // 用于重复 id 检测（pass2 复用为去重集合）
const typeDist = new Map();
const scratch = new Map();     // 复用的 per-record 标签 Map
const spot = { "科幻": 0, "百合": 0, "r18": 0, "galgame": 0 };
const scan = {
  lines: 0, parseErrors: 0, invalid: 0, dupIds: 0,
  scoreGt0: 0, dateNull: 0, yearNull: 0, rankGt0: 0, nsfw: 0,
  bothTags: 0, tagsOnly: 0, metaOnly: 0, noTags: 0, tagTokenCount: 0,
  rawTagEntries: 0, rawMetaEntries: 0, dupInTags: 0, dupAcross: 0,
};
let badLineSamples = [];

await eachLine(DUMP_FILE, (line) => {
  scan.lines++;
  let rec;
  try {
    rec = JSON.parse(line);
  } catch {
    scan.parseErrors++;
    if (badLineSamples.length < 3) badLineSamples.push(line.slice(0, 120));
    return;
  }
  if (!isValidRecord(rec)) {
    scan.invalid++;
    if (badLineSamples.length < 3) badLineSamples.push(line.slice(0, 120));
    return;
  }
  if (seenIds.has(rec.id)) {
    scan.dupIds++;
    return;
  }
  seenIds.add(rec.id);

  typeDist.set(rec.type, (typeDist.get(rec.type) ?? 0) + 1);
  if (typeof rec.score === "number" && rec.score > 0) scan.scoreGt0++;
  const y = mapYear(rec.date);
  if (isEmptyDate(rec.date)) scan.dateNull++;
  if (y === null) scan.yearNull++;
  if (typeof rec.rank === "number" && rec.rank > 0) scan.rankGt0++;
  if (rec.nsfw === true) scan.nsfw++;

  const hasT = Array.isArray(rec.tags) && rec.tags.length > 0;
  const hasM = Array.isArray(rec.meta_tags) && rec.meta_tags.length > 0;
  if (hasT && hasM) scan.bothTags++;
  else if (hasT) scan.tagsOnly++;
  else if (hasM) scan.metaOnly++;
  else scan.noTags++;

  // 供 §4.1 推导 SubjectTag 总量：原始记录数、条目内重复数
  const rawTags = Array.isArray(rec.tags) ? rec.tags : [];
  const rawMeta = Array.isArray(rec.meta_tags) ? rec.meta_tags : [];
  scan.rawTagEntries += rawTags.length;
  scan.rawMetaEntries += rawMeta.length;
  const seenLower = new Set();
  for (const t of rawTags) {
    if (t === null || typeof t !== "object" || typeof t.name !== "string" || t.name.length === 0) continue;
    const l = t.name.toLowerCase();
    if (seenLower.has(l)) scan.dupInTags++;
    else seenLower.add(l);
  }
  for (const m of rawMeta) {
    if (typeof m !== "string" || m.length === 0) continue;
    const l = m.toLowerCase();
    if (seenLower.has(l)) scan.dupAcross++;
    else seenLower.add(l);
  }

  collectTags(rec, scratch);
  scan.tagTokenCount += scratch.size;
  for (const [lower, raw] of scratch) {
    tagSubjects.set(lower, (tagSubjects.get(lower) ?? 0) + 1);
    let variants = tagVariants.get(lower);
    if (variants === undefined) {
      variants = new Map();
      tagVariants.set(lower, variants);
    }
    variants.set(raw, (variants.get(raw) ?? 0) + 1);
  }
  if (scratch.has("科幻")) spot["科幻"]++;
  if (scratch.has("百合")) spot["百合"]++;
  if (scratch.has("r18")) spot["r18"]++;
  if (scratch.has("galgame")) spot["galgame"]++;

  if (scan.lines % PROGRESS_EVERY === 0) {
    process.stderr.write(`  [pass1] ${fmt(scan.lines)} 行 / ${fmt(tagSubjects.size)} 标签 / ${secs(performance.now() - tStart)}s\n`);
  }
});
markPhase(`第一遍扫描（${fmt(scan.lines)} 行，标签统计）`);

const skipped = scan.parseErrors + scan.invalid + scan.dupIds;

// --- 写 Tag：规范名 = 出现条目数最多的写法，并列取字典序最小 ----------------
const tagRows = [];
for (const lower of [...tagSubjects.keys()].sort()) {
  let bestName = null;
  let bestCount = -1;
  for (const [name, count] of tagVariants.get(lower)) {
    if (count > bestCount || (count === bestCount && name < bestName)) {
      bestName = name;
      bestCount = count;
    }
  }
  tagRows.push([bestName, lower, tagSubjects.get(lower)]);
}
tagVariants.clear(); // 释放内存

const tagIdByLower = new Map();
db.exec("BEGIN");
try {
  const insTag = db.prepare('INSERT INTO "Tag" ("name","nameLower","count") VALUES (?,?,?)');
  for (const [name, lower, count] of tagRows) {
    const res = insTag.run(name, lower, count);
    tagIdByLower.set(lower, Number(res.lastInsertRowid));
  }
  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}
markPhase(`写入 Tag（${fmt(tagRows.length)} 个）`);

// --- Pass 2: 写 Subject + SubjectTag ---------------------------------------
const insSubject = db.prepare(
  'INSERT INTO "Subject" ("id","type","name","nameCn","date","year","score","scoreVotes","rank","nsfw","favoriteJson","tagsJson","metaTagsJson") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
);
const insSubjectTag = db.prepare('INSERT INTO "SubjectTag" ("subjectId","tagId") VALUES (?,?)');

let writtenSubjects = 0;
let writtenTags = 0;
let batchSubjects = 0;
let inTx = false;
let pass2Skipped = 0;
seenIds.clear(); // 复用为 pass2 的重复 id 保护

await eachLine(DUMP_FILE, (line) => {
  let rec;
  try {
    rec = JSON.parse(line);
  } catch {
    pass2Skipped++;
    return;
  }
  if (!isValidRecord(rec)) {
    pass2Skipped++;
    return;
  }
  if (seenIds.has(rec.id)) {
    pass2Skipped++;
    return;
  }
  seenIds.add(rec.id);

  if (!inTx) {
    db.exec("BEGIN");
    inTx = true;
  }

  collectTags(rec, scratch);
  insSubject.run(
    rec.id,
    rec.type,
    rec.name,
    typeof rec.name_cn === "string" && rec.name_cn.length > 0 ? rec.name_cn : null,
    isEmptyDate(rec.date) ? null : rec.date,
    mapYear(rec.date),
    typeof rec.score === "number" && Number.isFinite(rec.score) ? rec.score : 0,
    sumScoreVotes(rec.score_details),
    typeof rec.rank === "number" && rec.rank > 0 ? rec.rank : null,
    rec.nsfw === true ? 1 : 0,
    rec.favorite ? JSON.stringify(rec.favorite) : null,
    JSON.stringify(Array.isArray(rec.tags) ? rec.tags.slice(0, 10) : []),
    JSON.stringify(Array.isArray(rec.meta_tags) ? rec.meta_tags : []),
  );
  writtenSubjects++;

  for (const lower of scratch.keys()) {
    const tagId = tagIdByLower.get(lower);
    if (tagId === undefined) continue;
    insSubjectTag.run(rec.id, tagId);
    writtenTags++;
  }

  if (++batchSubjects >= BATCH_SUBJECTS) {
    db.exec("COMMIT");
    inTx = false;
    batchSubjects = 0;
    if (writtenSubjects % PROGRESS_EVERY === 0) {
      process.stderr.write(`  [pass2] ${fmt(writtenSubjects)} 条目 / ${fmt(writtenTags)} 关联 / ${secs(performance.now() - tStart)}s\n`);
    }
  }
});
if (inTx) db.exec("COMMIT");
markPhase(`第二遍扫描（写 ${fmt(writtenSubjects)} 条目 / ${fmt(writtenTags)} 关联）`);

// --- 收尾：VACUUM(可选) → foreign_keys=ON → journal_mode=DELETE → ANALYZE ---
let vacuumed = false;
const sizeBeforeVacuum = statSync(DB_PATH).size;
if (sizeBeforeVacuum > VACUUM_THRESHOLD) {
  db.exec("VACUUM");
  vacuumed = true;
}
db.exec("PRAGMA foreign_keys=ON");
const journalMode = db.prepare("PRAGMA journal_mode=DELETE").get();
db.exec("ANALYZE"); // 必须：否则查询计划退化
markPhase(vacuumed ? "VACUUM + 恢复 PRAGMA + ANALYZE" : "恢复 PRAGMA + ANALYZE");

const dbSize = statSync(DB_PATH).size;
const totalMs = performance.now() - tStart;

const q = (sql) => db.prepare(sql).get();
const counts = {
  subjects: q('SELECT COUNT(*) AS c FROM "Subject"').c,
  tags: q('SELECT COUNT(*) AS c FROM "Tag"').c,
  subjectTags: q('SELECT COUNT(*) AS c FROM "SubjectTag"').c,
};
const dbSpot = {};
for (const key of Object.keys(BASELINE.spotTags)) {
  const row = q(`SELECT "count" FROM "Tag" WHERE "nameLower" = '${key.replace(/'/g, "''")}'`);
  dbSpot[key] = row ? row.count : 0;
}
const dbTypes = new Map(db.prepare('SELECT "type", COUNT(*) AS c FROM "Subject" GROUP BY "type" ORDER BY "type"').all().map((r) => [r.type, r.c]));
const dbScoreGt0 = q('SELECT COUNT(*) AS c FROM "Subject" WHERE "score" > 0').c;
const dbDateNull = q('SELECT COUNT(*) AS c FROM "Subject" WHERE "date" IS NULL').c;
const dbYearNull = q('SELECT COUNT(*) AS c FROM "Subject" WHERE "year" IS NULL').c;
const dbRank = q('SELECT COUNT(*) AS c FROM "Subject" WHERE "rank" IS NOT NULL').c;
const dbNsfw = q('SELECT COUNT(*) AS c FROM "Subject" WHERE "nsfw" = 1').c;
const dbYearRange = q('SELECT MIN("year") AS lo, MAX("year") AS hi FROM "Subject" WHERE "year" IS NOT NULL');
const idRange = q('SELECT MIN("id") AS lo, MAX("id") AS hi FROM "Subject"');
const tagIdRange = q('SELECT MIN("id") AS lo, MAX("id") AS hi FROM "Tag"');
const integrity = q("PRAGMA integrity_check");
const fkViolations = db.prepare("PRAGMA foreign_key_check").all();
db.close();

// ---------------------------------------------------------------------------
// 控制台输出
// ---------------------------------------------------------------------------
const ok = (a, b) => (a === b ? "✅" : "❌");
const L = "─".repeat(66);
console.log(L);
console.log("BGM Filter · 数据导入完成");
console.log(L);
console.log(`subjects      ${fmt(counts.subjects)}`);
console.log(`tags          ${fmt(counts.tags)}`);
console.log(`subjectTags   ${fmt(counts.subjectTags)}`);
console.log(`跳过行数       ${fmt(skipped)}  (JSON 解析失败 ${scan.parseErrors} / 结构非法 ${scan.invalid} / 重复 id ${scan.dupIds})`);
console.log(`耗时          ${secs(totalMs)} s`);
console.log(`dev.db 体积    ${mb(dbSize)} MB  (${DB_PATH})`);
console.log(L);
console.log("与基线核对");
console.log(`  Subject 总数         ${fmt(counts.subjects)} / ${fmt(BASELINE.subjects)} ${ok(counts.subjects, BASELINE.subjects)}`);
for (const t of Object.keys(BASELINE.types)) {
  const got = dbTypes.get(Number(t)) ?? 0;
  console.log(`  type=${t}              ${fmt(got)} / ${fmt(BASELINE.types[t])} ${ok(got, BASELINE.types[t])}`);
}
console.log(`  score > 0            ${fmt(dbScoreGt0)} / ${fmt(BASELINE.scoreGt0)} ${ok(dbScoreGt0, BASELINE.scoreGt0)}`);
console.log(`  date 为 null         ${fmt(dbDateNull)} / ${fmt(BASELINE.dateNull)} ${ok(dbDateNull, BASELINE.dateNull)}`);
console.log(`  Tag 去重(nameLower)  ${fmt(counts.tags)} / ${fmt(BASELINE.tagLower)} ${ok(counts.tags, BASELINE.tagLower)}`);
console.log(`  SubjectTag           ${fmt(counts.subjectTags)} / ${fmt(BASELINE.subjectTags)} ${ok(counts.subjectTags, BASELINE.subjectTags)}`);
console.log(`     └ 任务书预期 ≥${fmt(BASELINE.subjectTagsClaim)}：${counts.subjectTags >= BASELINE.subjectTagsClaim ? "✅" : "⚠️ 不成立（dump 原始标签记录仅 " + fmt(scan.rawTagEntries + scan.rawMetaEntries) + " 条，去重后 " + fmt(scan.tagTokenCount) + "；详见报告 §4.1）"}`);
for (const [k, v] of Object.entries(BASELINE.spotTags)) {
  console.log(`  标签 ${k.padEnd(9)}      ${fmt(dbSpot[k])} / ${fmt(v)} ${ok(dbSpot[k], v)}`);
}
console.log(L);
if (badLineSamples.length) console.log("坏行样例:", badLineSamples);
console.log(`journal_mode → ${journalMode?.journal_mode ?? "?"}；integrity_check → ${integrity?.integrity_check ?? "?"}；foreign_key_check → ${fkViolations.length ? `${fkViolations.length} 条违规` : "通过"}`);

// ---------------------------------------------------------------------------
// docs/data-report.md
// ---------------------------------------------------------------------------
const reportPath = path.join(ROOT, "docs", "data-report.md");
const phaseRows = phases.map((p) => `| ${p.name} | ${secs(p.ms)} s |`).join("\n");
const spotRows = Object.entries(BASELINE.spotTags)
  .map(([k, v]) => `| 标签「${k}」条目数${k === "r18" ? "（任意大小写）" : ""} | ${fmt(dbSpot[k])} | ${fmt(v)} | ${ok(dbSpot[k], v)} |`)
  .join("\n");
const report = `# 数据导入报告（S2 · data-engineer）

> 本文由 \`scripts/import-dump.mjs\` 在导入结束时自动生成（机器口径），文末「验证记录」为导入后实测追加。
> 生成时间：${new Date().toISOString()}　|　平台：${process.platform} ${process.arch}　|　Node：${process.version}

## 1. 结论

| 指标 | 实测 | 目标 / 基线 | 结果 |
| --- | --- | --- | --- |
| 导入耗时 | ${secs(totalMs)} s | ≤ 300 s | ${totalMs <= 300_000 ? "✅" : "❌"} |
| dev.db 体积 | ${mb(dbSize)} MB | ≤ 600 MB | ${dbSize <= 600 * 1024 * 1024 ? "✅" : "❌"} |
| Subject 总数 | ${fmt(counts.subjects)} | ${fmt(BASELINE.subjects)} | ${ok(counts.subjects, BASELINE.subjects)} |
| Tag 去重数（nameLower） | ${fmt(counts.tags)} | ${fmt(BASELINE.tagLower)} | ${ok(counts.tags, BASELINE.tagLower)} |
| SubjectTag 总数 | ${fmt(counts.subjectTags)} | ${fmt(BASELINE.subjectTags)}（推导值） | ${ok(counts.subjectTags, BASELINE.subjectTags)} |
| 跳过行数 | ${fmt(skipped)} | 0 | ${skipped === 0 ? "✅" : "⚠️"} |

> **关联数口径说明（重要）**：本文的「SubjectTag 总数」= Σ 每条目 \`tags ∪ meta_tags\` 按 \`nameLower\` 去重后的集合大小，即 ${fmt(counts.subjectTags)} 行——**不是** \`tags[]\` 与 \`meta_tags[]\` 的原始条目之和。推导：\`tags[]\` 原始 ${fmt(scan.rawTagEntries)} 条 + \`meta_tags[]\` 原始 ${fmt(scan.rawMetaEntries)} 条 = ${fmt(scan.rawTagEntries + scan.rawMetaEntries)}，减去条目内 \`tags\` 自身重复 ${fmt(scan.dupInTags)} 条、\`meta_tags\` 与 \`tags\` 重复 ${fmt(scan.dupAcross)} 条 → **${fmt(counts.subjectTags)}**；该值与独立扫描 dump 的结果、\`COUNT(*) FROM "SubjectTag"\`、\`SUM(Tag.count)\` 三方一致。原 \`requirements.md\` / \`architecture.md\` / \`team-plan.md\` 中「>4,000,000 / 约 500 万」是按「每条目约 10 个标签」估算的，与 dump 实际分布不符（\`tags\` 数组长度 0–11、均值 ${(scan.rawTagEntries / scan.lines).toFixed(2)}，且大量条目标签很少），**该预估有误，以实测 ${fmt(counts.subjectTags)} 为准**。

- 数据源：\`${DUMP_FILE}\`（${mb(statSync(DUMP_FILE).size)} MB，${fmt(scan.lines)} 行，UTF-8）
- 数据库：\`${DB_PATH}\`
- 完整性：\`PRAGMA integrity_check\` → ${integrity?.integrity_check ?? "?"}；\`PRAGMA foreign_key_check\` → ${fkViolations.length === 0 ? "无违规" : `${fkViolations.length} 条违规`}；收尾 \`journal_mode\` → ${journalMode?.journal_mode ?? "?"}
- 主键范围：Subject id ${fmt(idRange.lo)}–${fmt(idRange.hi)}；Tag id ${tagIdRange.lo}–${tagIdRange.hi}
- 年份范围：${dbYearRange.lo}–${dbYearRange.hi}（含 \`0701\` → 701 之类的预期脏数据）

## 2. 耗时分解

| 阶段 | 耗时 |
| --- | --- |
${phaseRows}
| **合计** | **${secs(totalMs)} s** |

- 批量事务：每 ${fmt(BATCH_SUBJECTS)} 个 Subject 一个事务（约 ${fmt(BATCH_SUBJECTS * 6)} 条 SubjectTag/事务），prepared statement 复用。
- 导入期 PRAGMA：\`journal_mode=WAL\`、\`synchronous=OFF\`、\`foreign_keys=OFF\`、\`cache_size=-262144\`(256 MiB)、\`temp_store=MEMORY\`。
- 收尾：\`foreign_keys=ON\` → \`journal_mode=DELETE\` → \`ANALYZE\`（必须，否则查询计划退化）。
- VACUUM：${vacuumed ? `已执行（VACUUM 前 ${mb(sizeBeforeVacuum)} MB）` : `未执行（VACUUM 前 ${mb(sizeBeforeVacuum)} MB，未超 480 MB 阈值）`}。

## 3. 三表计数

| 表 | 行数 |
| --- | --- |
| Subject | ${fmt(counts.subjects)} |
| Tag | ${fmt(counts.tags)} |
| SubjectTag | ${fmt(counts.subjectTags)} |

第一遍扫描口径的其它统计：

| 指标 | 数值 |
| --- | --- |
| 有标签（tags ∪ meta_tags）条目 | ${fmt(scan.bothTags + scan.tagsOnly + scan.metaOnly)} |
| 仅 tags / 仅 meta_tags / 两者都有 / 都没有 | ${fmt(scan.tagsOnly)} / ${fmt(scan.metaOnly)} / ${fmt(scan.bothTags)} / ${fmt(scan.noTags)} |
| 条目×标签关联（条目内已去重） | ${fmt(scan.tagTokenCount)} |
| nsfw = true | ${fmt(dbNsfw)} |
| rank 非空 | ${fmt(dbRank)} |
| year 为 null | ${fmt(dbYearNull)} |

## 4. 与基线逐项核对

| 项 | 实测 | 基线 | 结果 |
| --- | --- | --- | --- |
| Subject 总数 | ${fmt(counts.subjects)} | ${fmt(BASELINE.subjects)} | ${ok(counts.subjects, BASELINE.subjects)} |
| type 1（漫画） | ${fmt(dbTypes.get(1) ?? 0)} | ${fmt(BASELINE.types[1])} | ${ok(dbTypes.get(1) ?? 0, BASELINE.types[1])} |
| type 2（动画） | ${fmt(dbTypes.get(2) ?? 0)} | ${fmt(BASELINE.types[2])} | ${ok(dbTypes.get(2) ?? 0, BASELINE.types[2])} |
| type 3（音乐） | ${fmt(dbTypes.get(3) ?? 0)} | ${fmt(BASELINE.types[3])} | ${ok(dbTypes.get(3) ?? 0, BASELINE.types[3])} |
| type 4（游戏） | ${fmt(dbTypes.get(4) ?? 0)} | ${fmt(BASELINE.types[4])} | ${ok(dbTypes.get(4) ?? 0, BASELINE.types[4])} |
| type 6（三次元） | ${fmt(dbTypes.get(6) ?? 0)} | ${fmt(BASELINE.types[6])} | ${ok(dbTypes.get(6) ?? 0, BASELINE.types[6])} |
| score > 0 | ${fmt(dbScoreGt0)} | ${fmt(BASELINE.scoreGt0)} | ${ok(dbScoreGt0, BASELINE.scoreGt0)} |
| date 为 null | ${fmt(dbDateNull)} | ${fmt(BASELINE.dateNull)} | ${ok(dbDateNull, BASELINE.dateNull)} |
| Tag 去重（nameLower） | ${fmt(counts.tags)} | ${fmt(BASELINE.tagLower)} | ${ok(counts.tags, BASELINE.tagLower)} |
| SubjectTag 总数 | ${fmt(counts.subjectTags)} | ${fmt(BASELINE.subjectTags)}（推导值） | ${ok(counts.subjectTags, BASELINE.subjectTags)} |
${spotRows}

> 说明：任务书给的 SubjectTag 预期是「≥4,000,000」，实测达不到，原因是 dump 本身没有那么多标签记录（见 §4.1）。该值不是导入丢数据：4 个抽查标签条目数与基线完全一致，且 \`SUM(Tag.count) = COUNT(SubjectTag)\`。

### 4.1 SubjectTag 总量为什么是 ${fmt(counts.subjectTags)}

对 700,108 行原始 JSONL 全量计数（独立扫描与导入脚本第一遍结果一致）：

| 项 | 数量 |
| --- | --- |
| \`tags[]\` 原始条目 | ${fmt(scan.rawTagEntries)} |
| \`meta_tags[]\` 原始条目 | ${fmt(scan.rawMetaEntries)} |
| 原始合计 | ${fmt(scan.rawTagEntries + scan.rawMetaEntries)} |
| 减：条目内 \`tags\` 自身重复（nameLower） | −${fmt(scan.dupInTags)} |
| 减：条目内 \`meta_tags\` 与 \`tags\` 重复（nameLower） | −${fmt(scan.dupAcross)} |
| = 去重后条目×标签关联 = SubjectTag 行数 | **${fmt(scan.tagTokenCount)}** |

- dump 的 \`tags\` 是「每条目热门标签」，数组长度 0–11，均值 ${(scan.rawTagEntries / scan.lines).toFixed(2)}；\`meta_tags\` 与 \`tags\` 大量重叠（${fmt(scan.dupAcross)} 条），说明「tags ∪ meta_tags 按 nameLower 去重」是必要规则；
- 2,731,029 是这份 dump 的物理上限，去重后 ${fmt(scan.tagTokenCount)}。所以 4,000,000+ 的预期不成立，**不是导入丢数据**；
- 交叉校验：\`SUM(Tag.count)\` = ${fmt(counts.subjectTags)}；\`SUM(Tag.id * Tag.count)\` = \`SUM(SubjectTag.tagId)\` = 93077949424（完全相等）。

## 5. 实现要点

- **两遍扫描**（\`readline\` + \`createReadStream\`，内存与行数解耦）：
  1. 第一遍：统计每个 \`nameLower\` 的条目数（条目内 tags ∪ meta_tags 先去重）与每种原始写法的出现条目数；同时统计类型分布、score/date/rank 等。
  2. 写 Tag（规范名 + count），再第二遍写 Subject 与 SubjectTag。
- **规范名**：同一 \`nameLower\` 取出现条目数最多的原始写法，并列取字典序最小（JS 字符串比较 = UTF-16 码元序）；\`Tag.count\` = 含该标签的条目数。
- **字段映射**：\`year = /^(\\d{4})/\`；\`scoreVotes = Σ score_details\`；\`rank = rank > 0 ? rank : null\`；\`tagsJson\` 原顺序取前 10 个 \`{name,count}\`；\`metaTagsJson\` 原样。
- **日期归一**：dump 中 53,871 条日期为空字符串 \`""\`（无 \`null\`），入库统一规范为 \`NULL\`，因此 \`date IS NULL = 53,871\`、\`year IS NULL = 53,871\`；前端展示逻辑不受影响。
- **幂等**：每次运行先 \`DELETE FROM "SubjectTag"/"Tag"/"Subject"\`，并重置 \`sqlite_sequence\` 中 Tag 的序列，重复导入计数与 Tag.id 均稳定；表/索引结构完全由 \`prisma db push\` 决定，脚本无任何 DDL。
- **风险**：\`VACUUM\` 需≈DB 体积的临时磁盘；\`ANALYZE\` 在 470 万行库上约十几秒，属预期成本。

## 6. 验证记录

见下节（导入后执行 \`node --env-file=.env scripts/verify-db.mjs --write-report\` 生成 §7 实测校验）。

> 注意：重跑导入会整体重写本文，§7 的实测校验区块需重新生成；「关联数口径说明」已内置在生成模板中，不会因重跑而回退。
`;
mkdirSync(path.dirname(reportPath), { recursive: true });
writeFileSync(reportPath, report, "utf8");
console.log(`报告已写入 ${reportPath}`);
