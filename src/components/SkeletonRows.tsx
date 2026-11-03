/** 结果骨架屏：12 行视觉占位（真实列表 96px 行高），避免加载时页面跳动。 */
export function SkeletonRows() {
  return (
    <div role="status" aria-live="polite" className="divide-y divide-slate-100">
      <span className="sr-only">正在加载结果…</span>
      {Array.from({ length: 12 }, (_, index) => (
        <div key={index} className="flex h-24 animate-pulse items-center gap-4 px-4" aria-hidden="true">
          <div className="hidden w-[72px] shrink-0 flex-col items-center gap-2 border-r border-slate-100 pr-3 sm:flex">
            <div className="h-6 w-10 rounded bg-slate-200" />
            <div className="h-3 w-14 rounded bg-slate-200" />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div className="h-4 w-1/2 rounded bg-slate-200" />
              <div className="h-4 w-24 rounded bg-slate-200" />
            </div>
            <div className="h-3 w-2/3 rounded bg-slate-200" />
            <div className="flex gap-2">
              <div className="h-4 w-12 rounded bg-slate-200" />
              <div className="h-4 w-14 rounded bg-slate-200" />
              <div className="h-4 w-10 rounded bg-slate-200" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
