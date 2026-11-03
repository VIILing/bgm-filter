/**
 * 查询构造与执行（`docs/architecture.md` §6）。
 *
 * - 输入是已通过 zod 校验的 `SearchInput`，输出 `SearchResultDto`；
 * - 所有用户输入（标签名、名称关键词）只通过 `?` 参数传入，禁止拼进 SQL；
 * - 使用 `prisma.$queryRawUnsafe`（SQLite `?` 占位符），结果显式声明 row 类型；
 * - DB 未导入 / 表不存在 / 文件不可读时，统一转成带 `pnpm db:import` 提示的
 *   `TRPCError`（INTERNAL_SERVER_ERROR），语法错误则为 BAD_REQUEST。
 */

import { TRPCError } from "@trpc/server";

import type { PrismaClient } from "@prisma/client";

import {
  PAGE_SIZE,
  type SearchInput,
  type SearchResultDto,
  type StatsDto,
  type SubjectCardDto,
  type TagSuggestionDto,
} from "~/shared/subject-contract";
import { db as defaultDb } from "~/server/db";
import { compileTagExpr, parseTagExpr, type TagExpr } from "~/server/tag-dsl";

/** 前端 / QA 可据此提示用户先导入数据。 */
export const DB_UNAVAILABLE_MESSAGE = "数据库未导入或不可读，请先运行 pnpm db:import";

/** 标签展示上限（F8）。 */
const MAX_CARD_TAGS = 8;

/** 贝叶斯加权评分：先验强度 m（评分人数中位数仅 3、p90=45）。 */
export const BAYESIAN_PRIOR_VOTES = 50;

/** 全局均值查询失败时的兜底值（当前 dump 实测 7.104，dump 静态不变）。 */
export const FALLBACK_GLOBAL_MEAN_SCORE = 7.1;

interface CountRow {
  c: number | bigint;
}

interface GlobalMeanRow {
  c: number | null;
}

interface SubjectRow {
  id: number;
  type: number;
  name: string;
  nameCn: string | null;
  date: string | null;
  year: number | null;
  score: number;
  scoreVotes: number;
  rank: number | null;
  nsfw: boolean | number;
  favoriteJson: string | null;
  tagsJson: string | null;
  metaTagsJson: string | null;
}

interface PageTagRow {
  subjectId: number;
  name: string;
  nameLower: string;
}

interface TagRow {
  name: string;
  count: number | bigint;
}

interface StatsTotalsRow {
  total: number | bigint;
  taggedTotal: number | bigint;
}

interface TypeCountRow {
  type: number | bigint;
  count: number | bigint;
}

interface ResolvedTags {
  /** nameLower → 规范展示名。 */
  canonicalByLower: Map<string, string>;
  /** 表达式中出现的已知标签规范名（按首次出现顺序去重）。 */
  parsedTags: string[];
  /** 不存在的标签（用户原始写法）。 */
  warnings: string[];
}

/** LIKE 通配符转义：`\`、`%`、`_`。 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function errorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 300);
}

/** 把 Prisma / SQLite 错误统一成可读的 TRPCError，已是 TRPCError 的原样抛出。 */
function toDatabaseError(error: unknown): TRPCError {
  if (error instanceof TRPCError) return error;
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: `${DB_UNAVAILABLE_MESSAGE}（${errorDetail(error)}）`,
    cause: error,
  });
}

function badRequest(message: string): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", message });
}

/** 解析表达式 + 年代兜底校验；失败抛 BAD_REQUEST（中文可读，含位置）。 */
function parseAndValidate(input: SearchInput): { ast: TagExpr; tags: string[] } {
  const parsed = parseTagExpr(input.tagExpr ?? "");
  if (!parsed.ok) {
    throw badRequest(
      `标签表达式错误（第 ${parsed.position + 1} 个字符附近）：${parsed.message}`,
    );
  }
  const yearFrom = input.yearFrom ?? null;
  const yearTo = input.yearTo ?? null;
  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
    throw badRequest(`起始年（${yearFrom}）不能大于结束年（${yearTo}）`);
  }
  return { ast: parsed.ast, tags: parsed.tags };
}

/** 一次性查询表达式中所有标签的存在性与规范名。 */
async function resolveTags(
  client: PrismaClient,
  tags: string[],
): Promise<ResolvedTags> {
  const canonicalByLower = new Map<string, string>();
  const parsedTags: string[] = [];
  const warnings: string[] = [];

  if (tags.length === 0) {
    return { canonicalByLower, parsedTags, warnings };
  }

  const lowered = Array.from(new Set(tags.map((tag) => tag.toLowerCase())));
  const rows = await client.tag.findMany({
    where: { nameLower: { in: lowered } },
    select: { name: true, nameLower: true },
  });
  for (const row of rows) {
    canonicalByLower.set(row.nameLower, row.name);
  }

  const seenParsed = new Set<string>();
  const seenWarnings = new Set<string>();
  for (const raw of tags) {
    const lower = raw.toLowerCase();
    const canonical = canonicalByLower.get(lower);
    if (canonical !== undefined) {
      if (!seenParsed.has(lower)) {
        seenParsed.add(lower);
        parsedTags.push(canonical);
      }
      continue;
    }
    if (!seenWarnings.has(lower)) {
      seenWarnings.add(lower);
      warnings.push(`未知标签：${raw}`);
    }
  }

  return { canonicalByLower, parsedTags, warnings };
}

interface WhereParts {
  /** 以 " WHERE " 开头；无条件时为空串。 */
  whereSql: string;
  params: unknown[];
}

/** WHERE 全部 AND：标签、类型、年代、名称。参数顺序与占位符一致。 */
function buildWhere(input: SearchInput, ast: TagExpr): WhereParts {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (ast.kind !== "all") {
    const compiled = compileTagExpr(ast);
    conditions.push(`s."id" IN (${compiled.sql})`);
    params.push(...compiled.params);
  }

  const types = Array.from(new Set(input.types ?? []));
  if (types.length > 0) {
    conditions.push(`s."type" IN (${types.map(() => "?").join(", ")})`);
    params.push(...types);
  }

  const yearFrom = input.yearFrom ?? null;
  if (yearFrom !== null) {
    conditions.push(`s."year" >= ?`);
    params.push(yearFrom);
  }
  const yearTo = input.yearTo ?? null;
  if (yearTo !== null) {
    conditions.push(`s."year" <= ?`);
    params.push(yearTo);
  }

  const keyword = (input.q ?? "").trim();
  if (keyword !== "") {
    const pattern = `%${escapeLike(keyword)}%`;
    conditions.push(`(s."name" LIKE ? ESCAPE '\\' OR s."nameCn" LIKE ? ESCAPE '\\')`);
    params.push(pattern, pattern);
  }

  return {
    whereSql: conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

/**
 * 贝叶斯加权评分（IMDb weighted rating）：`(score*votes + C*m) / (votes + m)`。
 *
 * 纯函数，便于单测与脚本复算；`score = 0` 的条目由调用方按「无评分」分组，
 * 不参与加权排序。C 为全局按人次加权平均分（动态查询，见 `getGlobalMeanScore`）。
 */
export function bayesianWeightedScore(
  score: number,
  scoreVotes: number,
  globalMean: number = FALLBACK_GLOBAL_MEAN_SCORE,
  priorVotes: number = BAYESIAN_PRIOR_VOTES,
): number {
  const votes = Number.isFinite(scoreVotes) ? Number(scoreVotes) : 0;
  const value = Number.isFinite(score) ? Number(score) : 0;
  return (value * votes + globalMean * priorVotes) / (votes + priorVotes);
}

/**
 * 全局按人次加权平均分 C：`SUM(score*scoreVotes) / SUM(scoreVotes)`，仅统计
 * `score > 0` 的条目（无评分条目没有有效分值，不能混进均值）。
 *
 * 缓存策略：模块级 WeakMap<PrismaClient, Promise<number>> 缓存计算结果。
 * dump 是静态只读数据，一次导入后 C 不再变化，因此进程内缓存即可；用
 * Promise 缓存可避免并发首查重复打 DB；按 client 实例缓存则让测试 / 多库
 * 各自得到自己的 C。查询失败不缓存（删除缓存项），回退 7.1 并允许下次重试。
 */
const globalMeanCache = new WeakMap<PrismaClient, Promise<number>>();

export async function getGlobalMeanScore(
  client: PrismaClient = defaultDb,
): Promise<number> {
  const cached = globalMeanCache.get(client);
  if (cached !== undefined) return cached;

  const pending = (async (): Promise<number> => {
    try {
      const rows = await client.$queryRawUnsafe<GlobalMeanRow[]>(
        `SELECT SUM(s."score" * s."scoreVotes") * 1.0 / SUM(s."scoreVotes") AS c FROM "Subject" s WHERE s."score" > 0`,
      );
      const value = Number(rows[0]?.c);
      return Number.isFinite(value) && value > 0
        ? value
        : FALLBACK_GLOBAL_MEAN_SCORE;
    } catch {
      // 失败不缓存：下次请求可重试（例如 db:import 刚完成）。
      globalMeanCache.delete(client);
      return FALLBACK_GLOBAL_MEAN_SCORE;
    }
  })();

  globalMeanCache.set(client, pending);
  return pending;
}

interface OrderParts {
  /** 不含 "ORDER BY " 前缀。 */
  orderSql: string;
  /** 与 orderSql 中 `?` 顺序一致，拼在 WHERE 参数之后。 */
  params: unknown[];
}

/**
 * ORDER BY：无评分分组 → 评分维度 → id 稳定排序。
 *
 * - 无评分：`(s."score" = 0) ASC|DESC`；
 * - `weighted_desc`：`(score*scoreVotes + C*m)/(scoreVotes + m) DESC`，
 *   C / m 全部走 `?` 参数（不拼接数值），参数顺序为 [C, m, m]；
 * - `score_desc` / `score_asc`：原始 `s."score" DESC|ASC`，再 `s."id" ASC`。
 */
async function buildOrderBy(
  input: SearchInput,
  client: PrismaClient,
): Promise<OrderParts> {
  const scorelessDirection = input.scoreless === "first" ? "DESC" : "ASC";

  if (input.sort === "weighted_desc") {
    const globalMean = await getGlobalMeanScore(client);
    return {
      orderSql: `(s."score" = 0) ${scorelessDirection}, (s."score" * s."scoreVotes" + ? * ?) * 1.0 / (s."scoreVotes" + ?) DESC, s."score" DESC, s."id" ASC`,
      params: [globalMean, BAYESIAN_PRIOR_VOTES, BAYESIAN_PRIOR_VOTES],
    };
  }

  const scoreDirection = input.sort === "score_asc" ? "ASC" : "DESC";
  return {
    orderSql: `(s."score" = 0) ${scorelessDirection}, s."score" ${scoreDirection}, s."id" ASC`,
    params: [],
  };
}

const SUBJECT_COLUMNS = [
  `s."id" AS id`,
  `s."type" AS type`,
  `s."name" AS name`,
  `s."nameCn" AS nameCn`,
  `s."date" AS date`,
  `s."year" AS year`,
  `s."score" AS score`,
  `s."scoreVotes" AS scoreVotes`,
  `s."rank" AS rank`,
  `s."nsfw" AS nsfw`,
  `s."favoriteJson" AS favoriteJson`,
  `s."tagsJson" AS tagsJson`,
  `s."metaTagsJson" AS metaTagsJson`,
].join(", ");

function readUserTagNames(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    const names: string[] = [];
    for (const item of parsed) {
      if (item !== null && typeof item === "object") {
        const name = (item as { name?: unknown }).name;
        if (typeof name === "string" && name.length > 0) names.push(name);
      }
    }
    return names;
  } catch {
    return [];
  }
}

function readMetaTagNames(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    );
  } catch {
    return [];
  }
}

function readFavoriteDone(json: string | null): number {
  if (!json) return 0;
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed === null || typeof parsed !== "object") return 0;
    const done = (parsed as { done?: unknown }).done;
    const value = Number(done);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/**
 * 卡片标签：用户标签（tagsJson 原顺序）优先 → 公共标签补足 → SubjectTag 兜底；
 * 大小写不敏感去重；展示时优先用 Tag 表的规范写法；最多 8 个。
 */
function pickCardTags(
  row: SubjectRow,
  canonicalByLower: Map<string, string>,
  tagNamesBySubject: Map<number, string[]>,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  const push = (name: string): void => {
    if (result.length >= MAX_CARD_TAGS) return;
    if (name.length === 0) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(canonicalByLower.get(key) ?? name);
  };

  for (const name of readUserTagNames(row.tagsJson)) push(name);
  for (const name of readMetaTagNames(row.metaTagsJson)) push(name);
  for (const name of tagNamesBySubject.get(Number(row.id)) ?? []) push(name);

  return result;
}

/**
 * 主搜索。输入解析错误 / 年份非法 → BAD_REQUEST；DB 不可用 → INTERNAL_SERVER_ERROR。
 */
export async function searchSubjects(
  input: SearchInput,
  client: PrismaClient = defaultDb,
): Promise<SearchResultDto> {
  const { ast, tags } = parseAndValidate(input);

  try {
    const resolved = await resolveTags(client, tags);
    const where = buildWhere(input, ast);

    const countRows = await client.$queryRawUnsafe<CountRow[]>(
      `SELECT COUNT(*) AS c FROM "Subject" s${where.whereSql}`,
      ...where.params,
    );
    const total = Number(countRows[0]?.c ?? 0);

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const requestedPage = Number(input.page);
    const page = Math.min(
      Math.max(Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1, 1),
      totalPages,
    );
    const offset = (page - 1) * PAGE_SIZE;

    let rows: SubjectRow[] = [];
    if (total > 0) {
      const order = await buildOrderBy(input, client);
      // 参数顺序：WHERE → ORDER BY（weighted 时为 C/m/m）→ LIMIT/OFFSET。
      rows = await client.$queryRawUnsafe<SubjectRow[]>(
        `SELECT ${SUBJECT_COLUMNS} FROM "Subject" s${where.whereSql} ORDER BY ${order.orderSql} LIMIT ? OFFSET ?`,
        ...where.params,
        ...order.params,
        PAGE_SIZE,
        offset,
      );
    }

    const subjectIds = rows.map((row) => Number(row.id));
    const pageTagRows: PageTagRow[] =
      subjectIds.length === 0
        ? []
        : await client.$queryRawUnsafe<PageTagRow[]>(
            [
              `SELECT st."subjectId" AS subjectId, t."name" AS name, t."nameLower" AS nameLower`,
              `FROM "SubjectTag" st`,
              `JOIN "Tag" t ON t."id" = st."tagId"`,
              `WHERE st."subjectId" IN (${subjectIds.map(() => "?").join(", ")})`,
              `ORDER BY st."subjectId" ASC, t."id" ASC`,
            ].join(" "),
            ...subjectIds,
          );

    const tagNamesBySubject = new Map<number, string[]>();
    const canonicalByLower = resolved.canonicalByLower;
    for (const row of pageTagRows) {
      const subjectId = Number(row.subjectId);
      const names = tagNamesBySubject.get(subjectId);
      if (names) {
        names.push(row.name);
      } else {
        tagNamesBySubject.set(subjectId, [row.name]);
      }
      const lower = row.nameLower;
      if (!canonicalByLower.has(lower)) canonicalByLower.set(lower, row.name);
    }

    const items: SubjectCardDto[] = rows.map((row) => ({
      id: Number(row.id),
      type: Number(row.type),
      name: row.name,
      nameCn: row.nameCn ?? null,
      date: row.date ?? null,
      year: row.year === null || row.year === undefined ? null : Number(row.year),
      score: Number(row.score),
      scoreVotes: Number(row.scoreVotes ?? 0),
      rank: row.rank === null || row.rank === undefined ? null : Number(row.rank),
      nsfw: Boolean(row.nsfw),
      tags: pickCardTags(row, canonicalByLower, tagNamesBySubject),
      favoriteDone: readFavoriteDone(row.favoriteJson),
    }));

    return {
      items,
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages,
      warnings: resolved.warnings,
      parsedTags: resolved.parsedTags,
    };
  } catch (error) {
    throw toDatabaseError(error);
  }
}

/** 标签联想 / 常用标签：nameLower LIKE（转义）→ count DESC, name ASC。 */
export async function searchTags(
  input: { q: string; limit: number },
  client: PrismaClient = defaultDb,
): Promise<TagSuggestionDto[]> {
  const rawLimit = Number(input.limit);
  const limit = Math.min(
    Math.max(Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 20, 1),
    50,
  );
  const keyword = (input.q ?? "").trim().toLowerCase();
  const pattern = `%${escapeLike(keyword)}%`;

  try {
    const rows = await client.$queryRawUnsafe<TagRow[]>(
      `SELECT t."name" AS name, t."count" AS count FROM "Tag" t WHERE t."nameLower" LIKE ? ESCAPE '\\' ORDER BY t."count" DESC, t."name" ASC LIMIT ?`,
      pattern,
      limit,
    );
    return rows.map((row) => ({ name: row.name, count: Number(row.count) }));
  } catch (error) {
    throw toDatabaseError(error);
  }
}

/** 头部统计：总条目、有标签条目、各类型条目数（type 升序）。 */
export async function getSubjectStats(
  client: PrismaClient = defaultDb,
): Promise<StatsDto> {
  try {
    const totals = await client.$queryRawUnsafe<StatsTotalsRow[]>(
      `SELECT (SELECT COUNT(*) FROM "Subject") AS total, (SELECT COUNT(DISTINCT "subjectId") FROM "SubjectTag") AS taggedTotal`,
    );
    const typeRows = await client.$queryRawUnsafe<TypeCountRow[]>(
      `SELECT s."type" AS type, COUNT(*) AS count FROM "Subject" s GROUP BY s."type" ORDER BY s."type" ASC`,
    );
    const row = totals[0];
    return {
      total: Number(row?.total ?? 0),
      taggedTotal: Number(row?.taggedTotal ?? 0),
      types: typeRows.map((entry) => ({
        type: Number(entry.type),
        count: Number(entry.count),
      })),
    };
  } catch (error) {
    throw toDatabaseError(error);
  }
}
