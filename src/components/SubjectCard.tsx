import { formatCount, formatYear } from "~/lib/format";
import { TYPE_LABEL, type SubjectCardDto } from "~/shared/subject-contract";

const TYPE_BADGE: Record<number, string> = {
  1: "bg-emerald-100 text-emerald-800",
  2: "bg-sky-100 text-sky-800",
  3: "bg-violet-100 text-violet-800",
  4: "bg-amber-100 text-amber-800",
  6: "bg-rose-100 text-rose-800",
};

export interface SubjectCardProps {
  subject: SubjectCardDto;
  onTagClick: (tag: string) => void;
}

/** 行式结果卡片：评分块 + 标题/中文名 + 类型徽标 + 日期 + rank/看过 + ≤8 标签。 */
export function SubjectCard({ subject, onTagClick }: SubjectCardProps) {
  const hasScore = subject.score > 0;
  const subtitle = subject.nameCn && subject.nameCn !== subject.name ? subject.nameCn : null;
  const dateText = formatYear(subject.year, subject.date);
  const tags = subject.tags.slice(0, 8);
  const fullTitle = subtitle ? `${subject.name} / ${subtitle}` : subject.name;

  return (
    <li className="group relative transition-colors hover:bg-slate-50">
      <a
        href={`https://bgm.tv/subject/${subject.id}`}
        target="_blank"
        rel="noreferrer"
        title={fullTitle}
        aria-label={`在 bgm.tv 打开 ${subject.name}`}
        className="absolute inset-0 z-0 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500"
      />

      <div className="pointer-events-none relative z-10 flex flex-col gap-2 px-3 py-3 sm:flex-row sm:gap-4 sm:px-4">
        <div className="flex w-full shrink-0 flex-row items-center justify-between gap-2 sm:w-[72px] sm:flex-col sm:justify-center sm:border-r sm:border-slate-100 sm:pr-3">
          <div className="flex items-baseline gap-1.5 sm:flex-col sm:items-center sm:gap-0">
            <span
              className={`text-2xl font-bold tabular-nums ${hasScore ? "text-slate-900" : "text-slate-400"}`}
              title={hasScore ? `评分 ${subject.score.toFixed(1)}` : "无评分"}
            >
              {hasScore ? subject.score.toFixed(1) : "—"}
            </span>
            <span className="text-[11px] text-slate-500">
              {hasScore ? `${formatCount(subject.scoreVotes)} 人评分` : "无评分"}
            </span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 truncate text-base font-medium text-slate-900" title={subject.name}>
              {subject.name}
            </h3>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                  TYPE_BADGE[subject.type] ?? "bg-slate-100 text-slate-700"
                }`}
              >
                {TYPE_LABEL[subject.type] ?? "其他"}
              </span>
              <span className="whitespace-nowrap text-xs tabular-nums text-slate-500" title="发行日期 / 年份">
                {dateText === "—" ? "日期未知" : dateText}
              </span>
            </div>
          </div>

          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
            {subtitle && (
              <span className="min-w-0 truncate" title={subtitle}>
                {subtitle}
              </span>
            )}
            {subject.rank !== null && subject.rank > 0 && (
              <span className="whitespace-nowrap tabular-nums" title="Bangumi 排名">
                #{subject.rank}
              </span>
            )}
            <span className="whitespace-nowrap tabular-nums" title="看过人数">
              看过 {subject.favoriteDone.toLocaleString("zh-CN")}
            </span>
          </div>

          {tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  title={`追加标签：${tag}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onTagClick(tag);
                  }}
                  className="pointer-events-auto relative z-20 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 transition hover:bg-slate-200 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
