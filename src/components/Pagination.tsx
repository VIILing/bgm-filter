export interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}

type PageItem = number | "ellipsis";

function buildPageItems(page: number, totalPages: number): PageItem[] {
  const pages = new Set<number>([1, totalPages]);
  for (let candidate = Math.max(1, page - 2); candidate <= Math.min(totalPages, page + 2); candidate += 1) {
    pages.add(candidate);
  }
  const sorted = Array.from(pages).sort((a, b) => a - b);
  const items: PageItem[] = [];
  let previous = 0;
  for (const current of sorted) {
    if (previous !== 0 && current - previous > 1) items.push("ellipsis");
    items.push(current);
    previous = current;
  }
  return items;
}

const navButtonClass =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500";

/** 首页 / 上一页 / 当前页 ±2 / 下一页 / 末页；当前页 aria-current。 */
export function Pagination({ page, totalPages, onChange }: PaginationProps) {
  const lastPage = Math.max(1, totalPages);
  const current = Math.min(Math.max(1, page), lastPage);
  const items = buildPageItems(current, lastPage);

  return (
    <nav aria-label="分页导航" className="mt-4 flex flex-wrap items-center justify-center gap-1">
      <button
        type="button"
        aria-label="第一页"
        disabled={current <= 1}
        onClick={() => onChange(1)}
        className={navButtonClass}
      >
        «
      </button>
      <button
        type="button"
        aria-label="上一页"
        disabled={current <= 1}
        onClick={() => onChange(current - 1)}
        className={navButtonClass}
      >
        ‹
      </button>

      {items.map((item, index) =>
        item === "ellipsis" ? (
          <span key={`ellipsis-${index}`} aria-hidden="true" className="px-1 text-sm text-slate-400">
            …
          </span>
        ) : (
          <button
            key={`page-${item}`}
            type="button"
            aria-label={`第 ${item} 页`}
            aria-current={item === current ? "page" : undefined}
            onClick={() => onChange(item)}
            className={`inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-sm tabular-nums transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
              item === current
                ? "border-slate-900 bg-slate-900 font-medium text-white"
                : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
            }`}
          >
            {item}
          </button>
        ),
      )}

      <button
        type="button"
        aria-label="下一页"
        disabled={current >= lastPage}
        onClick={() => onChange(current + 1)}
        className={navButtonClass}
      >
        ›
      </button>
      <button
        type="button"
        aria-label="最后一页"
        disabled={current >= lastPage}
        onClick={() => onChange(lastPage)}
        className={navButtonClass}
      >
        »
      </button>
    </nav>
  );
}
