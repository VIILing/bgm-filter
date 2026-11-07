"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";

import { TYPE_BADGE } from "~/components/SubjectCard";
import { formatYear } from "~/lib/format";
import { buildCoverCandidates, formatVotesRank } from "~/lib/preview";
import { TYPE_LABEL, type CoverUrls } from "~/shared/subject-contract";
import { trpc } from "~/trpc/react";

/** 弹窗需要展示的行基本信息（简介/标签按需请求，封面可由列表 map 复用）。 */
export interface SubjectDialogSubject {
  id: number;
  name: string;
  nameCn: string | null;
  type: number;
  year: number | null;
  date: string | null;
  score: number;
  scoreVotes: number;
  rank: number | null;
}

export interface SubjectDialogProps {
  subject: SubjectDialogSubject;
  /** 列表已加载的封面；`undefined` = 该块还没到（弹窗按单 id 兜底查询），`null` = 无封面。 */
  cover?: CoverUrls | null;
  /** 父级关闭动画进行中：视觉淡出并禁止交互。 */
  closing: boolean;
  /** 请求关闭（Esc / 右键 / 遮罩空白）。父级负责 150ms 动画与卸载。 */
  onClose: () => void;
}

/**
 * 面板几何沿用 Round 3 V2（`docs/round3-ui-spec.md` §3.1），只改定位方式：
 * 面板放进一个与面板同尺寸的 wrapper，由 dialog 层 flex 居中；
 * 独立按钮 `absolute left:100%` 且 `top:0`，因此顶边始终与面板顶边平齐。
 */
const PANEL_VARS: CSSProperties & Record<`--${string}`, string> = {
  "--panel-w": "min(880px, calc(100vw - 176px))",
  "--panel-h": "min(max(calc(100vh - 80px), 420px), calc(100vh - 72px))",
  "--upper-h": "clamp(280px, calc(var(--panel-h) * 0.52), 440px)",
};

const WRAPPER_STYLE: CSSProperties = {
  ...PANEL_VARS,
  width: "var(--panel-w)",
  height: "var(--panel-h)",
};

/** 封面槽内 2:3 占位块：宽 `min(Wc, Hc×2/3)`、高 `min(Hc, Wc×3/2)`，居中。 */
const COVER_PLACEHOLDER_SIZE: CSSProperties = {
  width: "min(var(--cover-w), calc(var(--upper-h) * 2 / 3))",
  height: "min(var(--upper-h), calc(var(--cover-w) * 1.5))",
};

/**
 * 打开/关闭关键帧。用 CSS animation 而不是「挂载后再 setState」：
 * 弹窗挂载即播放，不依赖 rAF 节流，不会出现首帧空白或动画延迟启动；
 * 只动 opacity/transform，面板布局几何不变。reduced-motion 下由 JS 设为 animation:none。
 */
const DIALOG_ANIMATION_CSS = `
@keyframes subject-dialog-fade-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes subject-dialog-fade-out { from { opacity: 1 } to { opacity: 0 } }
@keyframes subject-dialog-pop-in {
  from { transform: scale(0.92) translateY(6px) }
  to { transform: scale(1) translateY(0) }
}
@keyframes subject-dialog-pop-out {
  from { transform: scale(1) translateY(0) }
  to { transform: scale(0.97) translateY(0) }
}
@keyframes subject-dialog-jump-in {
  from { transform: translateY(6px) }
  to { transform: translateY(0) }
}
`;

/** 简介区骨架：文字提示 + 3 行灰条，简介到达后渐进替换（总高约 72，不撑高面板）。 */
function SummarySkeleton() {
  return (
    <div className="space-y-2" aria-busy="true">
      <p className="text-xs leading-4 text-slate-400">正在加载简介…</p>
      <div className="h-3 w-full animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
      <div className="h-3 w-5/6 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
      <div className="h-3 w-4/6 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
    </div>
  );
}

/** 标签区骨架：5 个灰色 chip（两行约 56px 高），标签数据到达后替换。 */
function TagSkeleton() {
  return (
    <div className="flex min-h-14 flex-wrap content-start gap-1.5" aria-busy="true" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((index) => (
        <div
          key={index}
          className="h-6 w-16 animate-pulse rounded bg-slate-100 motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}

/**
 * 封面加载状态。`key` 是候选 URL 集（换来源时同步重置），
 * `loadedUrl` 记录已确认可显示的 URL，避免切源/缓存命中时误判。
 */
interface CoverLoadState {
  key: string;
  failedCount: number;
  loadedUrl: string | null;
}

/**
 * 封面：`large → common → small → grid` 回退；natural-size contain，不放大、不裁边。
 * 组件以 `subject.id` 为 key 挂载，切条目时失败索引/已加载 URL 同步清零。
 */
function PreviewCover({ subject, cover }: { subject: SubjectDialogSubject; cover?: CoverUrls | null }) {
  // 列表 map 里还没有该 id 时，用单 id 查一次（复用同一缓存，不新增接口）。
  const singleCoverQuery = trpc.subject.covers.useQuery(
    { ids: [subject.id] },
    {
      enabled: cover === undefined,
      staleTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: false,
    },
  );

  const resolved: CoverUrls | null | undefined =
    cover !== undefined
      ? cover
      : singleCoverQuery.data !== undefined
        ? (singleCoverQuery.data[String(subject.id)] ?? null)
        : singleCoverQuery.isError
          ? null
          : undefined;

  const candidates = useMemo(() => buildCoverCandidates(resolved), [resolved]);
  const candidateKey = candidates.join("\n");

  // 封面加载状态。**不要用 useEffect 重置**：浏览器缓存命中时 onLoad 可能先于该 effect
  // 执行，effect 再把 loadedUrl 清空，而同一 img / 同一 src 不会再次触发 onLoad，
  // 结果就是「再次打开时 img 已 complete、naturalWidth>0，但 opacity 一直为 0」。
  const [loadState, setLoadState] = useState<CoverLoadState>(() => ({
    key: candidateKey,
    failedCount: 0,
    loadedUrl: null,
  }));

  // 候选集变化（单 id 查询返回 / 列表块到达）时在渲染期同步重置，不会与 onLoad 竞态。
  if (loadState.key !== candidateKey) {
    setLoadState({ key: candidateKey, failedCount: 0, loadedUrl: null });
  }

  const failedCount = loadState.key === candidateKey ? loadState.failedCount : 0;
  const loadedUrl = loadState.key === candidateKey ? loadState.loadedUrl : null;
  const currentUrl = candidates[failedCount] ?? null;

  const markLoaded = useCallback(() => {
    setLoadState((previous) =>
      previous.key === candidateKey && currentUrl !== null && previous.loadedUrl !== currentUrl
        ? { ...previous, loadedUrl: currentUrl }
        : previous,
    );
  }, [candidateKey, currentUrl]);

  // 缓存命中时图片可能在 ref 挂载时就已经 complete（onLoad 甚至已经错过）；
  // `complete && naturalWidth > 0` 是可靠信号，据此直接点亮，不依赖任何延时。
  const attachImage = useCallback(
    (node: HTMLImageElement | null) => {
      if (!node || currentUrl === null) return;
      if (node.complete && node.naturalWidth > 0) markLoaded();
    },
    [currentUrl, markLoaded],
  );

  const handleError = useCallback(() => {
    setLoadState((previous) =>
      previous.key === candidateKey
        ? { ...previous, failedCount: previous.failedCount + 1 }
        : previous,
    );
  }, [candidateKey]);

  const resolving = resolved === undefined;
  const noCover = !resolving && currentUrl === null;
  const loaded = currentUrl !== null && loadedUrl === currentUrl;
  const pulsing = resolving || (currentUrl !== null && !loaded);

  return (
    <div
      aria-busy={pulsing ? "true" : undefined}
      className="relative flex h-full w-[var(--cover-w)] shrink-0 items-center justify-center overflow-hidden"
    >
      <div
        aria-hidden={noCover ? undefined : "true"}
        data-preview-cover-placeholder=""
        style={COVER_PLACEHOLDER_SIZE}
        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-slate-100 transition-opacity duration-[120ms] motion-reduce:transition-none ${
          loaded ? "opacity-0" : "opacity-100"
        } ${pulsing ? "animate-pulse motion-reduce:animate-none" : ""}`}
      >
        {noCover && (
          <span className="flex h-full w-full items-center justify-center text-xs text-slate-500">
            无封面
          </span>
        )}
      </div>

      {currentUrl !== null && (
        <img
          key={currentUrl}
          ref={attachImage}
          src={currentUrl}
          alt={`${subject.name} 封面`}
          loading="eager"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onLoad={markLoaded}
          onError={handleError}
          className={`relative block h-auto max-h-full w-auto max-w-full rounded-md object-contain transition-opacity duration-[120ms] motion-reduce:transition-none ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </div>
  );
}

/** 是否偏好减少动效（reduced-motion）。 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}

/** 右上角外链图标（18px）。 */
function ExternalLinkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="h-[18px] w-[18px]"
    >
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

/**
 * 条目弹窗 V3：Portal 到 body，遮罩（z100）+ dialog 层（z101）+ 底部提示（z102）。
 *
 * - 面板内部完全沿用 Round 3 V2：左原图封面槽 + 右标题/元信息/标签 + 下区简介；
 * - 面板与 56×56 BGM 按钮放在同尺寸 wrapper 里，由 dialog 层 flex 居中；
 *   按钮 `absolute left:100% top:0`，顶边与面板顶边平齐、不参与面板布局；
 * - 关闭：Esc / 右键任意处 / 左键点遮罩空白；点面板/按钮不关闭；
 * - 锁定 body 滚动并用 scrollbar 宽度补偿，背景 `inert`，焦点进 dialog、关闭后由父级还原。
 */
export function SubjectDialog({ subject, cover, closing, onClose }: SubjectDialogProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const overlayPressRef = useRef(false);
  const reducedMotion = usePrefersReducedMotion();

  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // 标签 / 公共标签：本地 DB，毫秒级；组件只在点击打开后挂载。
  const previewQuery = trpc.subject.preview.useQuery(
    { id: subject.id },
    {
      enabled: true,
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  );

  // 简介：与封面同源懒加载（外部 API + cover_cache），接口永不抛错（失败/空 → null）。
  const summaryQuery = trpc.subject.summary.useQuery(
    { id: subject.id },
    {
      enabled: true,
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: false,
    },
  );

  // 滚动锁定 + 背景 inert + 焦点进入 + Esc/Tab/右键监听；卸载时全部还原。
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const html = document.documentElement;
    const body = document.body;
    const scrollY = window.scrollY;
    const scrollbarWidth = window.innerWidth - html.clientWidth;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyPaddingRight = body.style.paddingRight;

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;

    const inerted: Element[] = [];
    for (const child of Array.from(body.children)) {
      if (child === root || child.contains(root)) continue;
      if (child.hasAttribute("inert")) continue;
      child.setAttribute("inert", "");
      inerted.push(child);
    }

    const dialog = dialogRef.current;
    dialog?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const focusables = Array.from(
        wrapper.querySelectorAll<HTMLElement>('a[href], [tabindex="0"]'),
      );
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;

      if (!wrapper.contains(active) && active !== dialogRef.current) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && (active === first || active === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // 弹窗期间右键一律拦截浏览器菜单并关闭（面板、按钮、遮罩、文字上均生效）。
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      closeRef.current();
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("contextmenu", handleContextMenu, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("contextmenu", handleContextMenu, true);
      for (const child of inerted) child.removeAttribute("inert");
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
      body.style.paddingRight = previousBodyPaddingRight;
      if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
    };
  }, []);

  // 切换条目：两个内部滚动容器回到顶部。
  useEffect(() => {
    panelRef.current?.querySelectorAll<HTMLElement>("[data-preview-scroll]").forEach((node) => {
      node.scrollTop = 0;
    });
  }, [subject.id]);

  // React 的 onWheel 在根节点是 passive，preventDefault 无效；必须用 native listener。
  // 页面已锁定，仍然吞掉滚轮，只滚 [data-preview-scroll] 内部容器。
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const target = event.target instanceof Element ? event.target.closest("[data-preview-scroll]") : null;
      if (!(target instanceof HTMLElement)) return;
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? target.clientHeight : 1;
      target.scrollTop += event.deltaY * scale;
    };

    panel.addEventListener("wheel", handleWheel, { passive: false });
    return () => panel.removeEventListener("wheel", handleWheel);
  }, []);

  const handleOverlayPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    overlayPressRef.current = event.button === 0 && event.target === event.currentTarget;
  };

  const handleOverlayPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const shouldClose =
      overlayPressRef.current && event.button === 0 && event.target === event.currentTarget;
    overlayPressRef.current = false;
    if (shouldClose) onClose();
  };

  if (typeof document === "undefined") return null;

  const typeLabel = TYPE_LABEL[subject.type] ?? "其他";
  const badgeClass = TYPE_BADGE[subject.type] ?? "bg-slate-100 text-slate-700";
  const dateText = formatYear(subject.year, subject.date);
  const subtitle = subject.nameCn && subject.nameCn !== subject.name ? subject.nameCn : null;
  const hasScore = subject.score > 0;
  const votesRankText = formatVotesRank(subject.scoreVotes, subject.rank);
  const hasVotesRank = votesRankText !== "—";

  const preview = previewQuery.data;
  const tags = preview?.tags ?? [];
  const metaTags = preview?.metaTags ?? [];
  const summary = summaryQuery.data?.summary ?? null;

  const titleId = `subject-dialog-title-${subject.id}`;
  const descriptionId = `subject-dialog-description-${subject.id}`;
  const active = !closing;

  // 弹性 pop：面板/按钮只动 transform + opacity；遮罩只动 opacity。
  // 打开：遮罩 180ms ease-out；面板 opacity 160ms + transform 220ms 轻微回弹；
  // 按钮延迟 25ms 跟随；关闭 140ms ease-in，父级也在 140ms 后卸载。
  const overlayStyle: CSSProperties = {
    animation: reducedMotion
      ? "none"
      : closing
        ? "subject-dialog-fade-out 140ms ease-in both"
        : "subject-dialog-fade-in 180ms ease-out both",
  };
  const panelStyle: CSSProperties = {
    transform: reducedMotion ? "none" : closing ? "scale(0.97)" : "scale(1) translateY(0px)",
    transformOrigin: "center center",
    animation: reducedMotion
      ? "none"
      : closing
        ? "subject-dialog-pop-out 140ms ease-in both, subject-dialog-fade-out 140ms ease-in both"
        : "subject-dialog-pop-in 220ms cubic-bezier(0.34, 1.56, 0.64, 1) both, subject-dialog-fade-in 160ms ease-out both",
  };
  const jumpStyle: CSSProperties = {
    transform: reducedMotion ? "none" : "translateY(0px)",
    animation: reducedMotion
      ? "none"
      : closing
        ? "subject-dialog-fade-out 140ms ease-in both"
        : "subject-dialog-jump-in 220ms cubic-bezier(0.34, 1.56, 0.64, 1) 25ms both, subject-dialog-fade-in 220ms ease-out 25ms both",
  };
  const hintStyle: CSSProperties = {
    animation: reducedMotion
      ? "none"
      : closing
        ? "subject-dialog-fade-out 140ms ease-in both"
        : "subject-dialog-fade-in 180ms ease-out both",
  };

  const overlayClass = `fixed inset-0 z-[100] overscroll-none bg-[rgba(15,23,42,0.22)] backdrop-blur-[2px] ${
    active ? "opacity-100" : "opacity-0"
  } ${closing ? "pointer-events-none" : ""}`;
  const panelClass = `absolute inset-0 z-[101] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-[0_25px_50px_-12px_rgba(15,23,42,0.28)] [--cover-w:clamp(208px,28%,240px)] lg:p-5 lg:[--cover-w:288px] xl:p-6 xl:[--cover-w:300px] ${
    active ? "opacity-100" : "opacity-0"
  } ${closing ? "pointer-events-none" : "pointer-events-auto"}`;
  const jumpClass = `absolute left-full top-0 z-[102] ml-4 flex h-14 w-14 flex-col items-center justify-center gap-[3px] rounded-[14px] bg-slate-900 text-slate-50 shadow-[0_8px_24px_rgba(15,23,42,0.28)] hover:bg-slate-800 active:bg-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 xl:ml-5 ${
    active ? "opacity-100" : "opacity-0"
  } ${closing ? "pointer-events-none" : "pointer-events-auto"}`;

  return createPortal(
    <div ref={rootRef} data-subject-dialog-root="">
      <style>{DIALOG_ANIMATION_CSS}</style>
      <div
        aria-hidden="true"
        data-subject-dialog-overlay=""
        style={overlayStyle}
        className={overlayClass}
        onPointerDown={handleOverlayPointerDown}
        onPointerUp={handleOverlayPointerUp}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        data-subject-dialog=""
        className="pointer-events-none fixed inset-0 z-[101] flex items-center justify-center outline-none"
      >
        <div ref={wrapperRef} style={WRAPPER_STYLE} className="relative">
          <div ref={panelRef} data-subject-dialog-panel="" style={panelStyle} className={panelClass}>
            {/* 上区：左封面槽（固定 Wc × Hc）+ 右信息（标题 / 元信息 / 标签） */}
            <div className="flex h-[var(--upper-h)] shrink-0 gap-4 lg:gap-5 xl:gap-6">
              <PreviewCover key={subject.id} subject={subject} cover={cover} />

              <div className="flex h-full min-w-0 flex-1 flex-col">
                <div className="flex shrink-0 flex-col gap-2 lg:min-h-[69px] lg:flex-row lg:gap-4 xl:min-h-[72px]">
                  <div className="min-w-0 flex-1 lg:basis-auto">
                    <h3
                      id={titleId}
                      title={subject.name}
                      className="line-clamp-2 min-h-[45px] text-base font-semibold leading-[1.4] text-slate-900 [overflow-wrap:anywhere] lg:min-h-[48px] lg:text-[17px] xl:min-h-[50px] xl:text-[18px]"
                    >
                      {subject.name}
                    </h3>
                    {subtitle && (
                      <p title={subtitle} className="mt-0.5 truncate text-[13px] leading-[1.5] text-slate-500">
                        {subtitle}
                      </p>
                    )}
                  </div>

                  {/* 元信息：≥1024 右对齐 184px 三行；768–1023 移到标题下方两行 */}
                  <div className="flex flex-none flex-col items-start gap-1 lg:block lg:w-[184px] lg:text-right">
                    <div className="flex items-center gap-1.5 text-xs leading-5 lg:justify-end">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium leading-4 ${badgeClass}`}
                      >
                        {typeLabel}
                      </span>
                      <span className="tabular-nums text-slate-500">
                        {dateText === "—" ? "日期未知" : dateText}
                      </span>
                    </div>

                    <div className="flex items-baseline gap-1 leading-5 lg:mt-0.5 lg:justify-end">
                      {hasScore ? (
                        <>
                          <span className="text-base font-semibold tabular-nums text-slate-900 lg:text-[20px] lg:leading-6">
                            {subject.score.toFixed(1)}
                          </span>
                          <span className="text-[11px] font-normal text-slate-500">分</span>
                        </>
                      ) : (
                        <span className="text-[13px] font-normal text-slate-400">暂无评分</span>
                      )}
                      {hasVotesRank && (
                        <span className="text-[11px] font-normal tabular-nums text-slate-500 lg:hidden">
                          · {votesRankText}
                        </span>
                      )}
                    </div>

                    <div className="hidden text-[11px] leading-4 tabular-nums text-slate-500 lg:mt-0.5 lg:block">
                      {votesRankText}
                    </div>
                  </div>
                </div>

                <div className="mt-3.5 mb-2.5 shrink-0 border-t border-slate-100" />

                <div className="flex min-h-0 flex-1 flex-col">
                  <h4 className="mb-2 shrink-0 text-xs font-semibold leading-[18px] text-slate-700">
                    标签{" "}
                    <span className="font-normal tabular-nums text-slate-500">
                      {previewQuery.isPending ? "…" : tags.length}
                    </span>
                  </h4>

                  {previewQuery.isPending ? (
                    <TagSkeleton />
                  ) : previewQuery.isError ? (
                    <p className="text-xs leading-[18px] text-slate-500">预览加载失败</p>
                  ) : tags.length === 0 && metaTags.length === 0 ? (
                    <p className="text-xs leading-[18px] text-slate-400">暂无标签</p>
                  ) : (
                    <div
                      key={subject.id}
                      data-preview-tags=""
                      data-preview-scroll=""
                      aria-label="标签"
                      tabIndex={0}
                      className="flex min-h-0 flex-1 flex-wrap content-start gap-1.5 overflow-y-auto overscroll-contain pr-0.5 [scrollbar-color:#cbd5e1_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500"
                    >
                      {tags.map((tag) => (
                        <span
                          key={tag.name}
                          className="inline-flex max-w-full items-baseline gap-1.5 rounded bg-slate-100 px-2 py-0.5 text-xs leading-4 text-slate-700 hover:bg-slate-200"
                        >
                          <span className="min-w-0 truncate" title={tag.name}>
                            {tag.name}
                          </span>
                          <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{tag.count}</span>
                        </span>
                      ))}

                      {metaTags.length > 0 && (
                        <div className="mt-2.5 w-full border-t border-dashed border-slate-200 pt-2">
                          <p className="mb-1.5 text-[11px] leading-4 font-normal text-slate-400">公共标签</p>
                          <div className="flex flex-wrap gap-1">
                            {metaTags.map((tag) => (
                              <span
                                key={tag}
                                className="max-w-full truncate rounded border border-slate-200 bg-white px-1.5 py-px text-[11px] leading-4 text-slate-500"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 mb-4 shrink-0 border-t border-slate-100" />

            {/* 下区：简介（标题固定，正文占满剩余高度并内部滚动） */}
            <div className="flex min-h-0 flex-1 flex-col">
              <h4 className="mb-2 shrink-0 text-xs font-semibold leading-[18px] text-slate-700">简介</h4>
              <div
                key={subject.id}
                data-preview-summary=""
                data-preview-scroll=""
                aria-label="简介"
                tabIndex={0}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain whitespace-pre-wrap pr-0.5 text-[13px] leading-[1.7] text-slate-600 [overflow-wrap:anywhere] [scrollbar-color:#cbd5e1_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500"
              >
                {summaryQuery.isPending ? (
                  <SummarySkeleton />
                ) : summary ? (
                  summary
                ) : (
                  <p className="text-xs leading-4 text-slate-400">暂无简介</p>
                )}
              </div>
            </div>
          </div>

          <a
            href={`https://bgm.tv/subject/${subject.id}`}
            target="_blank"
            rel="noreferrer"
            aria-label="跳转至 BGM（在新标签页打开）"
            title="跳转至 BGM（在新标签页打开）"
            data-subject-dialog-jump=""
            onClick={(event) => event.stopPropagation()}
            style={jumpStyle}
            className={jumpClass}
          >
            <ExternalLinkIcon />
            <span className="text-[10px] font-medium tracking-[0.5px]">BGM</span>
          </a>
        </div>
      </div>

      <p
        aria-hidden="true"
        data-subject-dialog-hint=""
        style={hintStyle}
        className={`pointer-events-none fixed bottom-2 left-1/2 z-[102] -translate-x-1/2 whitespace-nowrap rounded-full border border-white/[0.55] bg-white/[0.55] px-[10px] py-[3px] text-[11px] leading-4 text-slate-700 backdrop-blur-[4px] ${
          active ? "opacity-100" : "opacity-0"
        }`}
      >
        点击空白处 / 右键 / Esc 关闭
      </p>
      <p id={descriptionId} className="sr-only">
        按 Esc 或右键任意处关闭
      </p>
    </div>,
    document.body,
  );
}
