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
  /** 指针进入面板：取消 ResultList 里挂起的关闭计时。 */
  onKeepAlive: () => void;
  /** 指针离开面板 / 页面滚动 / 窗口 resize：请求关闭。 */
  onRequestClose: () => void;
}

/** 面板最大宽度（内容列 1280 的一半）。 */
const PANEL_MAX_WIDTH = 640;
/** 面板最小宽度：窄屏仍按 48vw 缩小，但不低于 360。 */
const PANEL_MIN_WIDTH = 360;
/** 吸顶 Header 高度。 */
const HEADER_HEIGHT = 56;
/** 面板顶部：Header 下方 8px。 */
const TOP_OFFSET = HEADER_HEIGHT + 8;
/** 面板与视口右/下边缘的安全距离。 */
const EDGE_MARGIN = 12;
/** 高度 = 视口 - Header - 底部留白（24px）。 */
const BOTTOM_GAP = 24;
/** 与 `max-w-7xl` 一致的内容列最大宽度。 */
const CONTENT_MAX_WIDTH = 1280;
/** 内容列左右内边距（`px-4`）。 */
const CONTENT_GUTTER = 16;
/** 面板最小高度；极矮视口时以「不溢出」优先。 */
const PANEL_MIN_HEIGHT = 420;

interface PanelPlacement {
  top: number;
  right: number;
  width: number;
  height: number;
}

/**
 * 大预览面板定位（不跟随行 top，避免大面板上下跳）：
 * - 宽 `min(640px, 48vw)`，且不低于 360、不超出视口；
 * - 高 `min(vh - 80, ...)`，即 Header 下几乎整列高度；
 * - `top = 64`（Header 56 + 8）；
 * - `right = max(12, (vw - contentWidth)/2 + 8)`，`contentWidth = min(vw - 32, 1280)`，
 *   使面板右缘对齐内容列右缘（内缩 8px）。
 */
function computePlacement(viewportWidth: number, viewportHeight: number): PanelPlacement {
  const contentWidth = Math.min(viewportWidth - CONTENT_GUTTER * 2, CONTENT_MAX_WIDTH);
  const width = Math.max(
    PANEL_MIN_WIDTH,
    Math.min(PANEL_MAX_WIDTH, viewportWidth * 0.48, viewportWidth - EDGE_MARGIN * 2),
  );
  const desiredHeight = viewportHeight - HEADER_HEIGHT - BOTTOM_GAP;
  // 先保证「接近整列」，再夹到视口内（极矮视口时宁可不溢出也不强撑 420）。
  const height = Math.min(
    Math.max(desiredHeight, PANEL_MIN_HEIGHT),
    viewportHeight - TOP_OFFSET - EDGE_MARGIN,
  );
  return {
    top: TOP_OFFSET,
    right: Math.max(EDGE_MARGIN, (viewportWidth - contentWidth) / 2 + 8),
    width,
    height,
  };
}

/**
 * 悬浮预览：Portal 到 body 的 `position: fixed` 面板，固定在内容列右侧、约半列宽、
 * 接近整列高；避免被结果容器的 `overflow-hidden` 裁剪，也位于整卡 `<a>` 之上（z-50）。
 *
 * 结构（参考 ui-design.md §2.12）：标题 + 类型/年份 → 可滚动简介（不截断）→
 * 分隔线 → 底部标签（名称 + 计数，可滚动）+ 公共标签。
 *
 * 滚轮：面板内用 native `wheel`（passive:false）拦截，只滚 `[data-preview-scroll]`
 * 容器；容器已到边界或没有容器时滚轮被吞掉，页面/列表绝不滚动。
 * 面板自身阻止 click / mousedown 冒泡，因此点面板不会跳转 bgm.tv。
 */
export function HoverPreview({ subject, onKeepAlive, onRequestClose }: HoverPreviewProps) {
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
        typeof window === "undefined" ? 0 : window.innerWidth,
        typeof window === "undefined" ? 0 : window.innerHeight,
      ),
    [],
  );

  // 页面滚动 / 窗口 resize 时面板位置失效，直接关闭；面板内部的简介/标签滚动不算。
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

  // React 的 onWheel 在根节点是 passive，preventDefault 无效；必须用 native listener。
  // 指针在面板内时永远 preventDefault（吞掉滚动），仅手动滚动面板内部容器。
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const target = event.target instanceof Element ? event.target.closest("[data-preview-scroll]") : null;
      if (!(target instanceof HTMLElement)) return;
      const scale =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? target.clientHeight : 1;
      target.scrollTop += event.deltaY * scale;
    };

    panel.addEventListener("wheel", handleWheel, { passive: false });
    return () => panel.removeEventListener("wheel", handleWheel);
  }, []);

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
      <div className="shrink-0 border-b border-slate-100 px-4 py-3">
        <h3 className="truncate text-base font-medium text-slate-900" title={subject.name}>
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
        data-preview-scroll=""
        className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap px-4 py-3 text-[13px] leading-relaxed text-slate-600"
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

      <div className="shrink-0 border-t border-slate-100 px-4 py-3">
        <p className="mb-1.5 text-xs font-medium text-slate-700">
          标签 <span className="tabular-nums text-slate-500">{tags.length}</span>
        </p>
        {tags.length === 0 ? (
          <p className="text-xs text-slate-400">暂无标签</p>
        ) : (
          <div
            data-preview-tags=""
            data-preview-scroll=""
            className="flex max-h-[200px] flex-wrap gap-1 overflow-y-auto"
          >
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
          <div className="mt-3">
            <p className="mb-1 text-[11px] text-slate-400">公共标签</p>
            <div
              data-preview-meta=""
              data-preview-scroll=""
              className="flex max-h-[72px] flex-wrap gap-1 overflow-y-auto"
            >
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
