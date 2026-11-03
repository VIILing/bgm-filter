export interface ResultSummaryProps {
  total: number | undefined;
  page: number;
  totalPages: number;
  warnings: string[];
  hasTagFilter: boolean;
  onClearTags: () => void;
}

/** 结果摘要：总数 / 页码 / 警告 / 清空标签。 */
export function ResultSummary({
  total,
  page,
  totalPages,
  warnings,
  hasTagFilter,
  onClearTags,
}: ResultSummaryProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="font-medium text-slate-800">
        共 {total === undefined ? "—" : total.toLocaleString("zh-CN")} 条
      </span>
      <span className="text-slate-500">
        第 {page}/{totalPages} 页
      </span>
      {hasTagFilter && (
        <button
          type="button"
          onClick={onClearTags}
          className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          清空标签
        </button>
      )}
      {warnings.map((warning, index) => (
        <span key={`${warning}-${index}`} className="text-xs text-amber-700" role="status">
          ⚠ {warning}
        </span>
      ))}
    </div>
  );
}
