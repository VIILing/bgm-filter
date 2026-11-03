import type { ScorelessMode, SortMode } from "~/lib/url-state";

export interface SortControlsProps {
  sort: SortMode;
  scoreless: ScorelessMode;
  onSortChange: (sort: SortMode) => void;
  onScorelessChange: (scoreless: ScorelessMode) => void;
}

const segmentButtonClass = (active: boolean) =>
  `px-2.5 py-1 text-xs font-medium transition first:rounded-l-md last:rounded-r-md focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
    active ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
  }`;

const defaultSegmentClass = (active: boolean) =>
  `px-2.5 py-1 text-xs font-medium transition first:rounded-l-md last:rounded-r-md focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
    active ? "bg-sky-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
  }`;

/** 评分排序（默认贝叶斯加权）+ 无评分条目位置。 */
export function SortControls({ sort, scoreless, onSortChange, onScorelessChange }: SortControlsProps) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">排序</span>
        <div className="inline-flex overflow-hidden rounded-md border border-slate-300" role="group" aria-label="评分排序">
          <button
            type="button"
            aria-pressed={sort === "weighted_desc"}
            onClick={() => onSortChange("weighted_desc")}
            className={segmentButtonClass(sort === "weighted_desc")}
          >
            <span className="inline-flex items-center gap-1">
              综合评分
              <span
                className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-slate-300 text-[10px] font-normal opacity-80"
                title="按贝叶斯加权：评分 × 人数，弱化小样本刷分"
                aria-label="按贝叶斯加权：评分 × 人数，弱化小样本刷分"
                role="img"
              >
                ?
              </span>
            </span>
          </button>
          <button
            type="button"
            aria-pressed={sort === "score_desc"}
            onClick={() => onSortChange("score_desc")}
            className={`border-l border-slate-300 ${segmentButtonClass(sort === "score_desc")}`}
          >
            评分从高到低
          </button>
          <button
            type="button"
            aria-pressed={sort === "score_asc"}
            onClick={() => onSortChange("score_asc")}
            className={`border-l border-slate-300 ${segmentButtonClass(sort === "score_asc")}`}
          >
            评分从低到高
          </button>
        </div>
      </div>

      <div>
        <span className="mb-1 flex items-center gap-1 text-sm font-medium text-slate-700">
          无评分
          <span
            className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-slate-300 text-[10px] font-normal text-slate-500"
            title="仅影响无评分条目，同组内按 ID 升序"
            aria-label="仅影响无评分条目，同组内按 ID 升序"
            role="img"
          >
            ?
          </span>
        </span>
        <div
          className="inline-flex overflow-hidden rounded-md border border-slate-300"
          role="group"
          aria-label="无评分条目位置"
        >
          <button
            type="button"
            aria-pressed={scoreless === "last"}
            onClick={() => onScorelessChange("last")}
            className={defaultSegmentClass(scoreless === "last")}
          >
            置底
          </button>
          <button
            type="button"
            aria-pressed={scoreless === "first"}
            onClick={() => onScorelessChange("first")}
            className={`border-l border-slate-300 ${defaultSegmentClass(scoreless === "first")}`}
          >
            置顶
          </button>
        </div>
      </div>
    </div>
  );
}
