export interface HeaderStats {
  total: number;
  taggedTotal: number;
}

export interface HeaderProps {
  stats?: HeaderStats | null;
  isLoading?: boolean;
}

function formatTotal(value: number): string {
  return value.toLocaleString("zh-CN");
}

/** 深色标题栏：标题 + 数据库统计（失败/加载中不阻塞页面）。 */
export function Header({ stats, isLoading = false }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 bg-slate-900 text-slate-100 shadow-sm">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-4 px-4">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-white">BGM Filter</h1>
          <span className="hidden truncate text-xs text-slate-400 sm:inline">Bangumi 条目筛选器</span>
        </div>
        <p className="shrink-0 text-right text-xs text-slate-300 sm:text-sm">
          {stats ? (
            <>
              <span>共 {formatTotal(stats.total)} 条</span>
              {stats.taggedTotal > 0 && (
                <span className="hidden md:inline"> · 有标签 {formatTotal(stats.taggedTotal)} 条</span>
              )}
            </>
          ) : (
            <span className="text-slate-400">{isLoading ? "…" : "统计不可用"}</span>
          )}
        </p>
      </div>
    </header>
  );
}
