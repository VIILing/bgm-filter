"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EmptyState } from "~/components/EmptyState";
import { ErrorState } from "~/components/ErrorState";
import { FilterPanel } from "~/components/FilterPanel";
import { Header } from "~/components/Header";
import { Pagination } from "~/components/Pagination";
import { ResultList } from "~/components/ResultList";
import { ResultSummary } from "~/components/ResultSummary";
import { SkeletonRows } from "~/components/SkeletonRows";
import { insertTag } from "~/lib/tag-insert";
import { parseTagExpr } from "~/lib/tag-parse-lite";
import {
  ALL_TYPE_VALUES,
  isAllTypes,
  MAX_SEARCH_LENGTH,
  MAX_TAG_EXPR_LENGTH,
  MAX_YEAR,
  MIN_YEAR,
  normalizeTypes,
  parseFilterState,
  toSearchParams,
  type FilterState,
  type ScorelessMode,
  type SortMode,
} from "~/lib/url-state";
import { trpc } from "~/trpc/react";

interface UiState {
  tagExpr: string;
  q: string;
  types: number[];
  yearFromText: string;
  yearToText: string;
  sort: SortMode;
  scoreless: ScorelessMode;
  page: number;
}

interface ParsedYearInput {
  value: number | null;
  invalid: boolean;
}

function parseYearInput(text: string): ParsedYearInput {
  const trimmed = text.trim();
  if (trimmed === "") return { value: null, invalid: false };
  if (!/^\d+$/.test(trimmed)) return { value: null, invalid: true };
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < MIN_YEAR || value > MAX_YEAR) {
    return { value: null, invalid: true };
  }
  return { value, invalid: false };
}

function toUiState(state: FilterState): UiState {
  return {
    tagExpr: state.tagExpr,
    q: state.q,
    types: [...state.types],
    yearFromText: state.yearFrom === null ? "" : String(state.yearFrom),
    yearToText: state.yearTo === null ? "" : String(state.yearTo),
    sort: state.sort,
    scoreless: state.scoreless,
    page: state.page,
  };
}

function createDefaultUiState(): UiState {
  return {
    tagExpr: "",
    q: "",
    types: [...ALL_TYPE_VALUES],
    yearFromText: "",
    yearToText: "",
    sort: "score_desc",
    scoreless: "last",
    page: 1,
  };
}

function toFilterState(state: UiState): FilterState {
  return {
    tagExpr: state.tagExpr,
    q: state.q,
    types: normalizeTypes(state.types),
    yearFrom: parseYearInput(state.yearFromText).value,
    yearTo: parseYearInput(state.yearToText).value,
    sort: state.sort,
    scoreless: state.scoreless,
    page: state.page,
  };
}

export function HomeClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();

  const [state, setState] = useState<UiState>(() => toUiState(parseFilterState(searchParams)));
  const appliedUrlRef = useRef(searchParamsString);
  const resultTopRef = useRef<HTMLElement>(null);
  const [focusToken, setFocusToken] = useState(0);

  const tagParse = useMemo(() => parseTagExpr(state.tagExpr), [state.tagExpr]);
  const parsedFrom = useMemo(() => parseYearInput(state.yearFromText), [state.yearFromText]);
  const parsedTo = useMemo(() => parseYearInput(state.yearToText), [state.yearToText]);

  const yearTextInvalid = parsedFrom.invalid || parsedTo.invalid;
  const rangeInvalid =
    !parsedFrom.invalid &&
    !parsedTo.invalid &&
    parsedFrom.value !== null &&
    parsedTo.value !== null &&
    parsedFrom.value > parsedTo.value;
  const yearError = yearTextInvalid
    ? `年份需为 ${MIN_YEAR}–${MAX_YEAR} 的整数`
    : rangeInvalid
      ? "起始年不能大于结束年"
      : null;
  const canSearch = tagParse.ok && yearError === null;

  const searchInput = useMemo(() => {
    const types = normalizeTypes(state.types);
    return {
      tagExpr: state.tagExpr.trim(),
      q: state.q.trim(),
      types: isAllTypes(types) ? undefined : types,
      yearFrom: parsedFrom.value,
      yearTo: parsedTo.value,
      sort: state.sort,
      scoreless: state.scoreless,
      page: state.page,
    };
  }, [
    state.tagExpr,
    state.q,
    state.types,
    state.sort,
    state.scoreless,
    state.page,
    parsedFrom.value,
    parsedTo.value,
  ]);

  const searchQuery = trpc.subject.search.useQuery(searchInput, {
    enabled: canSearch,
    placeholderData: keepPreviousData,
  });
  const statsQuery = trpc.subject.stats.useQuery();

  const writeUrl = useCallback(
    (next: UiState) => {
      const params = toSearchParams(toFilterState(next));
      const queryString = params.toString();
      if (queryString === appliedUrlRef.current) return;
      appliedUrlRef.current = queryString;
      const base = pathname || "/";
      router.replace(queryString ? `${base}?${queryString}` : base, { scroll: false });
    },
    [pathname, router],
  );

  // 筛选变化：本地立即生效，300ms 后写入 URL；年份文本非法时保留上一次 URL。
  useEffect(() => {
    if (yearTextInvalid) return;
    const timer = window.setTimeout(() => writeUrl(state), 300);
    return () => window.clearTimeout(timer);
  }, [state, yearTextInvalid, writeUrl]);

  // 浏览器前进/后退：URL 被外部改变时还原本地状态。
  useEffect(() => {
    if (searchParamsString === appliedUrlRef.current) return;
    appliedUrlRef.current = searchParamsString;
    setState(toUiState(parseFilterState(new URLSearchParams(searchParamsString))));
  }, [searchParamsString]);

  const updateFilters = useCallback((patch: Partial<Omit<UiState, "page">>) => {
    setState((previous) => ({ ...previous, ...patch, page: 1 }));
  }, []);

  const changePage = (page: number) => {
    const next: UiState = { ...state, page };
    setState(next);
    // 年份文本非法时无法安全写入 URL（会丢失正在输入的文本），等修正后由 debounce 写入。
    if (!yearTextInvalid) writeUrl(next);
    resultTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const resetFilters = () => {
    const next = createDefaultUiState();
    setState(next);
    writeUrl(next);
  };

  const appendTag = useCallback((tag: string) => {
    setState((previous) => {
      const { expr } = insertTag(previous.tagExpr, previous.tagExpr.length, tag);
      if (expr === previous.tagExpr) return previous;
      return { ...previous, tagExpr: expr, page: 1 };
    });
    setFocusToken((token) => token + 1);
  }, []);

  const typeCounts = useMemo(() => {
    const counts: Partial<Record<number, number>> = {};
    for (const item of statsQuery.data?.types ?? []) {
      counts[item.type] = item.count;
    }
    return counts;
  }, [statsQuery.data]);

  const result = searchQuery.data;
  const items = result?.items ?? [];
  const totalPages = Math.max(1, result?.totalPages ?? 1);
  const displayPage = searchQuery.isPlaceholderData ? state.page : (result?.page ?? state.page);
  const isInitialLoading = canSearch && searchQuery.isPending && result === undefined;
  const isRefreshing = searchQuery.isFetching && !isInitialLoading;
  const errorMessage = searchQuery.error?.message ?? "未知错误";

  const pauseReasons: string[] = [];
  if (!tagParse.ok) {
    pauseReasons.push(
      `表达式有误：${tagParse.message ?? "无法解析"}（第 ${(tagParse.position ?? 0) + 1} 个字符附近）`,
    );
  }
  if (yearError) pauseReasons.push(yearError);

  const isDefaultFilters =
    state.tagExpr.trim() === "" &&
    state.q.trim() === "" &&
    isAllTypes(state.types) &&
    state.yearFromText.trim() === "" &&
    state.yearToText.trim() === "" &&
    state.sort === "score_desc" &&
    state.scoreless === "last" &&
    state.page === 1;

  return (
    <div className="min-h-screen bg-slate-50">
      <Header stats={statsQuery.data} isLoading={statsQuery.isPending} />

      <main className="mx-auto w-full max-w-7xl px-4 pb-16">
        <FilterPanel
          tagExpr={state.tagExpr}
          tagParse={tagParse}
          onTagExprChange={(value) => updateFilters({ tagExpr: value.slice(0, MAX_TAG_EXPR_LENGTH) })}
          focusToken={focusToken}
          query={state.q}
          onQueryChange={(value) => updateFilters({ q: value.slice(0, MAX_SEARCH_LENGTH) })}
          yearFromText={state.yearFromText}
          yearToText={state.yearToText}
          yearError={yearError}
          onYearFromChange={(value) => updateFilters({ yearFromText: value })}
          onYearToChange={(value) => updateFilters({ yearToText: value })}
          types={state.types}
          onTypesChange={(types) => updateFilters({ types: normalizeTypes(types) })}
          typeCounts={typeCounts}
          countsLoading={statsQuery.isPending}
          sort={state.sort}
          scoreless={state.scoreless}
          onSortChange={(sort) => updateFilters({ sort })}
          onScorelessChange={(scoreless) => updateFilters({ scoreless })}
          canReset={!isDefaultFilters}
          onReset={resetFilters}
        />

        <section ref={resultTopRef} className="scroll-mt-32 pt-1" aria-busy={searchQuery.isFetching}>
          {isRefreshing && (
            <div
              className="h-0.5 w-full animate-pulse bg-sky-500"
              role="progressbar"
              aria-label="正在刷新结果"
            />
          )}

          <div className="pt-3">
            <ResultSummary
              total={result?.total}
              page={displayPage}
              totalPages={totalPages}
              warnings={result?.warnings ?? []}
              hasTagFilter={state.tagExpr.trim() !== ""}
              onClearTags={() => updateFilters({ tagExpr: "" })}
            />
          </div>

          {pauseReasons.length > 0 && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
              <p className="font-medium">已暂停查询，修正后会自动刷新（保留上一次结果）</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {pauseReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3">
            {searchQuery.isError ? (
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <ErrorState
                  message={errorMessage}
                  onRetry={() => void searchQuery.refetch()}
                  isRetrying={searchQuery.isFetching}
                />
              </div>
            ) : !canSearch && result === undefined ? null : isInitialLoading ? (
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <SkeletonRows />
              </div>
            ) : result !== undefined && items.length === 0 ? (
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <EmptyState
                  tagExpr={state.tagExpr}
                  q={state.q}
                  types={state.types}
                  yearFrom={parsedFrom.value}
                  yearTo={parsedTo.value}
                  onClearTags={() => updateFilters({ tagExpr: "" })}
                  onClearYears={() => updateFilters({ yearFromText: "", yearToText: "" })}
                  onClearQuery={() => updateFilters({ q: "" })}
                />
              </div>
            ) : result !== undefined ? (
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <ResultList items={items} onTagClick={appendTag} />
              </div>
            ) : null}
          </div>

          {canSearch && !searchQuery.isError && result !== undefined && items.length > 0 && (
            <Pagination page={displayPage} totalPages={totalPages} onChange={changePage} />
          )}
        </section>
      </main>
    </div>
  );
}
