import { TYPE_LABEL } from "~/shared/subject-contract";
import { isAllTypes } from "~/lib/url-state";

export interface EmptyStateProps {
  tagExpr: string;
  q: string;
  types: number[];
  yearFrom: number | null;
  yearTo: number | null;
  onClearTags: () => void;
  onClearYears: () => void;
  onClearQuery: () => void;
}

const actionClass =
  "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500";

/** 无结果：条件摘要 + 宽松化建议。 */
export function EmptyState({
  tagExpr,
  q,
  types,
  yearFrom,
  yearTo,
  onClearTags,
  onClearYears,
  onClearQuery,
}: EmptyStateProps) {
  const conditions: string[] = [];
  if (tagExpr.trim()) conditions.push(`标签：${tagExpr.trim()}`);
  if (yearFrom !== null || yearTo !== null) {
    conditions.push(`年代：${yearFrom ?? "不限"}–${yearTo ?? "不限"}`);
  }
  if (!isAllTypes(types)) {
    conditions.push(`类型：${types.map((type) => TYPE_LABEL[type] ?? String(type)).join("、")}`);
  }
  if (q.trim()) conditions.push(`名称：${q.trim()}`);

  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-center" role="status">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-2xl" aria-hidden="true">
        🔎
      </span>
      <h2 className="text-lg font-semibold text-slate-800">没有匹配的条目</h2>
      <p className="max-w-2xl text-sm text-slate-500">
        当前条件：{conditions.length > 0 ? conditions.join(" · ") : "无（全部条目）"}
      </p>
      <p className="text-xs text-slate-400">可以试试清空标签、放宽年代，或取消名称搜索。</p>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        {tagExpr.trim() && (
          <button type="button" onClick={onClearTags} className={actionClass}>
            清空标签
          </button>
        )}
        {(yearFrom !== null || yearTo !== null) && (
          <button type="button" onClick={onClearYears} className={actionClass}>
            放宽年代
          </button>
        )}
        {q.trim() && (
          <button type="button" onClick={onClearQuery} className={actionClass}>
            取消名称搜索
          </button>
        )}
      </div>
    </div>
  );
}
