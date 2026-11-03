import { SUBJECT_TYPES } from "../shared/subject-contract";

/** 归档类型（与 shared 契约保持一致）：1 漫画 / 2 动画 / 3 音乐 / 4 游戏 / 6 三次元。 */
export const ALL_TYPE_VALUES: readonly number[] = SUBJECT_TYPES.map((t) => t.value);

export type SortMode = "weighted_desc" | "score_desc" | "score_asc";
export type ScorelessMode = "last" | "first";

/** URL 可表达、且前端/服务端查询共用的筛选状态。 */
export interface FilterState {
  tagExpr: string;
  q: string;
  types: number[];
  yearFrom: number | null;
  yearTo: number | null;
  sort: SortMode;
  scoreless: ScorelessMode;
  page: number;
}

export const MAX_SEARCH_LENGTH = 100;
export const MAX_TAG_EXPR_LENGTH = 500;
export const MIN_YEAR = 1000;
export const MAX_YEAR = 2100;

/** URLSearchParams、Next 的 ReadonlyURLSearchParams、或 App Router 的 searchParams 记录。 */
export type SearchParamsInput =
  | URLSearchParams
  | { get(name: string): string | null }
  | Record<string, string | string[] | undefined>;

export const DEFAULT_FILTER_STATE: FilterState = {
  tagExpr: "",
  q: "",
  types: [...ALL_TYPE_VALUES],
  yearFrom: null,
  yearTo: null,
  sort: "weighted_desc",
  scoreless: "last",
  page: 1,
};

export function createDefaultFilterState(): FilterState {
  return { ...DEFAULT_FILTER_STATE, types: [...ALL_TYPE_VALUES] };
}

function isSearchParamsLike(value: unknown): value is { get(name: string): string | null } {
  return typeof (value as { get?: unknown }).get === "function";
}

function readParam(input: SearchParamsInput, key: string): string | undefined {
  if (isSearchParamsLike(input)) {
    const value = input.get(key);
    return value ?? undefined;
  }
  const raw = (input as Record<string, string | string[] | undefined>)[key];
  if (Array.isArray(raw)) return key === "types" ? raw.join(",") : raw[0];
  return raw ?? undefined;
}

/** 把任意 types 输入规范化：只保留合法类型；全选或空 → 全部 5 类。 */
export function normalizeTypes(types: readonly number[]): number[] {
  const selected = new Set(types.filter((t) => ALL_TYPE_VALUES.includes(t)));
  if (selected.size === 0 || selected.size === ALL_TYPE_VALUES.length) {
    return [...ALL_TYPE_VALUES];
  }
  return ALL_TYPE_VALUES.filter((t) => selected.has(t));
}

export function isAllTypes(types: readonly number[]): boolean {
  return normalizeTypes(types).length === ALL_TYPE_VALUES.length;
}

function parseTypesParam(raw: string | undefined): number[] {
  if (!raw) return [...ALL_TYPE_VALUES];
  const selected = new Set<number>();
  for (const token of raw.split(",")) {
    const trimmed = token.trim();
    if (!/^\d+$/.test(trimmed)) continue;
    const value = Number(trimmed);
    if (ALL_TYPE_VALUES.includes(value)) selected.add(value);
  }
  return normalizeTypes([...selected]);
}

function parseYearParam(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < MIN_YEAR || value > MAX_YEAR) return null;
  return value;
}

function parsePageParam(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return 1;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 1) return 1;
  return value;
}

/** 非法参数回退默认值；未知标签不算参数错误。 */
export function parseFilterState(searchParams: SearchParamsInput): FilterState {
  const rawTag = readParam(searchParams, "tag");
  const rawQ = readParam(searchParams, "q");
  const rawSort = readParam(searchParams, "sort");
  const rawScoreless = readParam(searchParams, "scoreless");

  return {
    tagExpr: (rawTag ?? "").trim().slice(0, MAX_TAG_EXPR_LENGTH),
    q: (rawQ ?? "").trim().slice(0, MAX_SEARCH_LENGTH),
    types: parseTypesParam(readParam(searchParams, "types")),
    yearFrom: parseYearParam(readParam(searchParams, "from")),
    yearTo: parseYearParam(readParam(searchParams, "to")),
    sort:
      rawSort === "score_desc" || rawSort === "score_asc"
        ? rawSort
        : "weighted_desc",
    scoreless: rawScoreless === "first" ? "first" : "last",
    page: parsePageParam(readParam(searchParams, "page")),
  };
}

/** 默认值一律省略；types 用半角逗号连接；page=1 省略。 */
export function toSearchParams(state: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  const tagExpr = state.tagExpr.trim().slice(0, MAX_TAG_EXPR_LENGTH);
  const q = state.q.trim().slice(0, MAX_SEARCH_LENGTH);

  if (tagExpr) params.set("tag", tagExpr);
  if (q) params.set("q", q);

  const types = normalizeTypes(state.types);
  if (!isAllTypes(types)) params.set("types", types.join(","));

  if (
    state.yearFrom !== null &&
    Number.isInteger(state.yearFrom) &&
    state.yearFrom >= MIN_YEAR &&
    state.yearFrom <= MAX_YEAR
  ) {
    params.set("from", String(state.yearFrom));
  }
  if (
    state.yearTo !== null &&
    Number.isInteger(state.yearTo) &&
    state.yearTo >= MIN_YEAR &&
    state.yearTo <= MAX_YEAR
  ) {
    params.set("to", String(state.yearTo));
  }

  // 默认 weighted_desc 省略；原始评分排序显式写入。
  if (state.sort === "score_desc" || state.sort === "score_asc") {
    params.set("sort", state.sort);
  }
  if (state.scoreless === "first") params.set("scoreless", "first");
  if (Number.isSafeInteger(state.page) && state.page > 1) params.set("page", String(state.page));

  return params;
}
