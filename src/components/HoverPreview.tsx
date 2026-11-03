"use client";

import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

import { formatYear } from "~/lib/format";
import { TYPE_LABEL } from "~/shared/subject-contract";
import { trpc } from "~/trpc/react";

/** 预览面板需要展示的行的基本信息（不含简介/标签，那些按需请求）。 */
export interface HoverPreviewSubject {
  id: number;
  name: string;
  type: number;
  year: number | null;
  date: string | null;
}

export interface HoverPreviewProps {
  subject: HoverPreviewSubject;
  /** 行的 `getBoundingClientRect()`，用于把面板贴在行右缘。 */
  anchorRect: DOMRect;
  /** 指针进入面板：取消 ResultList 里挂起的关闭计时。 */
  onKeepAlive: () => void;
  /** 指针离开面板 / 页面滚动 / 窗口 resize：请求关闭。 */
  onRequestClose: () => void;
}

/** 面板设计尺寸；实际会被视口夹紧（见 computePlacement）。 */
const PANEL_MAX_WIDTH = 380;
const PANEL_MAX_HEIGHT = 440;
const VIEWPORT_MARGIN = 12;
/** 面板右缘与行右缘的间距。 */
const ANCHOR_GAP = 8;

interface PanelPlacement {
  top: number;
  right: number;
  width: number;
  height: number;
}

/**
 * 以行为锚点计算 fixed 定位：
 * - `top = clamp(rect.top, 12, vh - panelH - 12)`；
 * - `right = max(12, vw - rect.right + 8)`，即面板右缘贴着行右缘（向内 8px）；
 * - 宽 `min(380, vw - 24)`，高 `min(440, 70vh)`。
 */
function computePlacement(rect: DOMRect, viewportWidth: number, viewportHeight: number): PanelPlacement {
  const width = Math.max(160, Math.min(PANEL_MAX_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2));
  const height = Math.max(160, Math.min(PANEL_MAX_HEIGHT, viewportHeight * 0.7));
  const maxTop = Math.max(VIEWPORT_MARGIN, viewportHeight - height - VIEWPORT_MARGIN);
  return {
    top: Math.min(Math.max(rect.top, VIEWPORT_MARGIN), maxTop),
    right: Math.max(VIEWPORT_MARGIN, viewportWidth - rect.right + ANCHOR_GAP),
    width,
    height,
  };
}

/**
 * 悬浮预览：Portal 到 body 的 `position: fixed` 面板，避免被结果容器的
 * `overflow-hidden` 裁剪，也保证位于整卡 `<a>` 覆盖层之上（z-50）。
 *
 * 结构（参考 ui-design.md §2.12）：标题 + 类型/年份 → 可滚动简介（不截断）→
 * 分隔线 → 标签（名称 + 计数，可滚动）+ 公共标签。
 * 面板自身阻止 click / mousedown 冒泡，因此点面板不会跳转 bgm.tv。
 */
export function HoverPreview({
  subject,
  anchorRect,
  onKeepAlive,
  onRequestClose,
}: HoverPreviewProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // 组件只在 hover 打开后挂载，等价于 `enabled: open`；缓存 5 分钟避免快速划过时重复请求。
  const previewQuery = trpc.subject.preview.useQuery(
    { id: subject.id },
    {
      enabled: true,
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  );

  const placement = useMemo(
    () =>
      computePlacement(
        anchorRect,
        typeof window === "undefined" ? 0 : window.innerWidth,
        typeof window === "undefined" ? 0 : window.innerHeight,
      ),
    [anchorRect],
  );

  // 页面滚动 / 窗口 resize 时面板锚点失效，直接关闭；面板内部的简介/标签滚动不算。
  useEffect(() => {
    const handleScroll = (event: Event) => {
      const panel = panelRef.current;
      if (panel && event.target instanceof Node && panel.contains(event.target)) return;
      onRequestClose();
    };
    const handleResize = () => onRequestClose();
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
    };
  }, [onRequestClose]);

  if (typeof document === "undefined") return null;

  const typeLabel = TYPE_LABEL[subject.type] ?? "其他";
  const dateText = formatYear(subject.year, subject.date);
  const preview = previewQuery.data;
  const tags = preview?.tags ?? [];
  const metaTags = preview?.metaTags ?? [];
  const summary = preview?.summary ?? null;

  return createPortal(
    <div
      ref={panelRef}
      role="tooltip"
      aria-label="条目预览"
      data-hover-preview=""
      className="fixed z-50 flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
      style={placement}
      onMouseEnter={onKeepAlive}
      onMouseLeave={onRequestClose}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="shrink-0 border-b border-slate-100 px-3 py-2">
        <h3 className="truncate text-sm font-medium text-slate-900" title={subject.name}>
          {subject.name}
        </h3>
        <p className="mt-0.5 text-xs text-slate-500">
          {typeLabel}
          {" · "}
          <span className="tabular-nums">{dateText === "—" ? "日期未知" : dateText}</span>
        </p>
      </div>

      <div
        data-preview-summary=""
        className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap px-3 py-2 text-[13px] leading-relaxed text-slate-600"
      >
        {previewQuery.isError ? (
          <p className="text-slate-500">预览加载失败</p>
        ) : previewQuery.isPending ? (
          <p className="text-slate-400">加载中…</p>
        ) : summary ? (
          summary
        ) : (
          <p className="text-slate-400">暂无简介</p>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-100 px-3 py-2">
        <p className="mb-1.5 text-xs font-medium text-slate-700">
          标签 <span className="tabular-nums text-slate-500">{tags.length}</span>
        </p>
        {tags.length === 0 ? (
          <p className="text-xs text-slate-400">暂无标签</p>
        ) : (
          <div data-preview-tags="" className="flex max-h-[132px] flex-wrap gap-1 overflow-y-auto">
            {tags.map((tag) => (
              <span
                key={tag.name}
                className="inline-flex max-w-full items-baseline gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600"
              >
                <span className="truncate" title={tag.name}>
                  {tag.name}
                </span>
                <span className="shrink-0 tabular-nums text-slate-400">{tag.count}</span>
              </span>
            ))}
          </div>
        )}

        {metaTags.length > 0 && (
          <div className="mt-2">
            <p className="mb-1 text-[11px] text-slate-400">公共标签</p>
            <div className="flex max-h-[46px] flex-wrap gap-1 overflow-y-auto">
              {metaTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-500"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
