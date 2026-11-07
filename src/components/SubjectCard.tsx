"use client";

import { useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";

import { formatCount, formatYear } from "~/lib/format";
import { TYPE_LABEL, type CoverUrls, type SubjectCardDto } from "~/shared/subject-contract";

/** 类型徽标配色（列表行与悬浮预览共用，保证两处颜色一致）。 */
export const TYPE_BADGE: Record<number, string> = {
  1: "bg-emerald-100 text-emerald-800",
  2: "bg-sky-100 text-sky-800",
  3: "bg-violet-100 text-violet-800",
  4: "bg-amber-100 text-amber-800",
  6: "bg-rose-100 text-rose-800",
};

export interface SubjectCardProps {
  subject: SubjectCardDto;
  /** 封面 URL；`undefined` = 尚未加载，`null` = 无封面 / NSFW / 失败。 */
  cover?: CoverUrls | null;
  onTagClick: (tag: string) => void;
  /** 是否启用点击弹窗（≥768 且鼠标设备）；禁用时行保留原始 target=_blank 跳转。 */
  dialogEnabled?: boolean;
  /** 普通左键 / Enter / Space：打开弹窗；参数是触发行链接，用于关闭后还原焦点。 */
  onOpen?: (trigger: HTMLElement) => void;
}

/**
 * 行式结果卡片：左侧 2:3 封面（无图时灰底占位，保持比例避免 CLS），
 * 右侧标题/中文名 + 类型徽标 + 日期 + 评分/rank/看过 meta 行 + ≤8 标签。
 *
 * 封面只负责展示，不阻塞文字渲染：`cover` 未到达时先显示占位块，到达后替换。
 * 加载失败记录失败的 URL 并切回占位，同一 URL 不会反复重试。
 * 悬浮只做行高亮（CSS），不触发任何预览请求；点击整卡由 ResultList 打开弹窗。
 */
export function SubjectCard({ subject, cover, onTagClick, dialogEnabled, onOpen }: SubjectCardProps) {
  const [failedCoverUrl, setFailedCoverUrl] = useState<string | null>(null);
  const hasScore = subject.score > 0;
  const subtitle = subject.nameCn && subject.nameCn !== subject.name ? subject.nameCn : null;
  const dateText = formatYear(subject.year, subject.date);
  const tags = subject.tags.slice(0, 8);
  const fullTitle = subtitle ? `${subject.name} / ${subtitle}` : subject.name;
  const canOpenDialog = Boolean(dialogEnabled && onOpen);

  const coverUrl = cover?.small && cover.small.length > 0 ? cover.small : null;
  const showCover = coverUrl !== null && coverUrl !== failedCoverUrl;

  // 普通左键打开弹窗；Ctrl/Cmd/Shift/中键保留浏览器「新标签直跳」的默认行为。
  const handleClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!canOpenDialog || !onOpen) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.button !== 0) return;
    event.preventDefault();
    onOpen(event.currentTarget);
  };

  // 行获得焦点时 Enter/Space 打开；带修饰键时保留浏览器默认（新窗口/标签）。
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLAnchorElement>) => {
    if (!canOpenDialog || !onOpen) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpen(event.currentTarget);
  };

  return (
    <li className="group relative transition-colors hover:bg-slate-50">
      <a
        href={`https://bgm.tv/subject/${subject.id}`}
        target="_blank"
        rel="noreferrer"
        title={canOpenDialog ? `打开预览：${fullTitle}` : fullTitle}
        aria-label={
          canOpenDialog ? `打开 ${subject.name} 预览弹窗` : `在 bgm.tv 打开 ${subject.name}`
        }
        aria-haspopup={canOpenDialog ? "dialog" : undefined}
        data-subject-trigger=""
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className="absolute inset-0 z-0 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500"
      />

      <div className="pointer-events-none relative z-10 flex items-start gap-3 px-3 py-3 sm:gap-4 sm:px-4">
        <div className="aspect-[2/3] w-[56px] shrink-0 overflow-hidden rounded bg-slate-100 sm:w-[76px]">
          {showCover ? (
            <img
              src={coverUrl}
              alt={`${subject.name} 封面`}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
              onError={() => setFailedCoverUrl(coverUrl)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">
              无封面
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-base font-medium text-slate-900" title={subject.name}>
                {subject.name}
              </h3>
              {subtitle && (
                <p className="truncate text-xs text-slate-500" title={subtitle}>
                  {subtitle}
                </p>
              )}
            </div>
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

          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
            {hasScore ? (
              <span
                className="whitespace-nowrap tabular-nums"
                title={`评分 ${subject.score.toFixed(1)} · ${subject.scoreVotes} 人评分`}
              >
                <span className="font-medium tabular-nums text-slate-700">{subject.score.toFixed(1)}</span>
                {" · "}
                <span>{formatCount(subject.scoreVotes)} 人评分</span>
              </span>
            ) : (
              <span className="whitespace-nowrap tabular-nums text-slate-400" title="暂无评分">
                — 无评分
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
