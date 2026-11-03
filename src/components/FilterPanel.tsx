import { TagExprInput } from "~/components/TagExprInput";
import { TypeFilter } from "~/components/TypeFilter";
import { YearRangeInput } from "~/components/YearRangeInput";
import { SortControls } from "~/components/SortControls";
import type { TagParseResult } from "~/lib/tag-parse-lite";
import type { ScorelessMode, SortMode } from "~/lib/url-state";

export interface FilterPanelProps {
  tagExpr: string;
  tagParse: TagParseResult;
  onTagExprChange: (value: string) => void;
  focusToken: number;

  query: string;
  onQueryChange: (value: string) => void;

  yearFromText: string;
  yearToText: string;
  yearError: string | null;
  onYearFromChange: (value: string) => void;
  onYearToChange: (value: string) => void;

  types: number[];
  onTypesChange: (types: number[]) => void;
  typeCounts: Partial<Record<number, number>>;
  countsLoading: boolean;

  sort: SortMode;
  scoreless: ScorelessMode;
  onSortChange: (sort: SortMode) => void;
  onScorelessChange: (scoreless: ScorelessMode) => void;

  canReset: boolean;
  onReset: () => void;
}

const nameInputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200";

/** 白色筛选卡片：sticky（桌面） + 重置。 */
export function FilterPanel({
  tagExpr,
  tagParse,
  onTagExprChange,
  focusToken,
  query,
  onQueryChange,
  yearFromText,
  yearToText,
  yearError,
  onYearFromChange,
  onYearToChange,
  types,
  onTypesChange,
  typeCounts,
  countsLoading,
  sort,
  scoreless,
  onSortChange,
  onScorelessChange,
  canReset,
  onReset,
}: FilterPanelProps) {
  return (
    <div className="relative z-20 -mx-4 bg-slate-50/95 px-4 pb-2 pt-4 backdrop-blur md:sticky md:top-14">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" aria-label="筛选条件">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-800">筛选</h2>
        </div>

        <TagExprInput value={tagExpr} onChange={onTagExprChange} parse={tagParse} focusToken={focusToken} />

        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="subject-query" className="mb-1 block text-sm font-medium text-slate-700">
              名称搜索
            </label>
            <input
              id="subject-query"
              type="text"
              maxLength={100}
              autoComplete="off"
              placeholder="按名称 / 中文名搜索"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              className={nameInputClass}
            />
            <p className="mt-1 text-xs text-slate-500">大小写不敏感，最多 100 字</p>
          </div>

          <YearRangeInput
            fromText={yearFromText}
            toText={yearToText}
            onFromChange={onYearFromChange}
            onToChange={onYearToChange}
            error={yearError}
          />

          <div className="lg:col-span-2">
            <TypeFilter
              types={types}
              onChange={onTypesChange}
              typeCounts={typeCounts}
              countsLoading={countsLoading}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <SortControls
            sort={sort}
            scoreless={scoreless}
            onSortChange={onSortChange}
            onScorelessChange={onScorelessChange}
          />
          <div className="flex items-center gap-3">
            <p className="hidden text-xs text-slate-400 lg:block">筛选变化后自动查询，条件会同步到地址栏</p>
            <button
              type="button"
              onClick={onReset}
              disabled={!canReset}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              重置筛选
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
