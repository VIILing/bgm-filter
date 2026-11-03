"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { HoverPreview } from "~/components/HoverPreview";
import { SubjectCard } from "~/components/SubjectCard";
import type { CoverUrls, SubjectCardDto } from "~/shared/subject-contract";

export interface ResultListProps {
  items: SubjectCardDto[];
  /** 以字符串 id 为键的封面 URL；缺失 / null 时卡片显示占位块。 */
  covers: Record<string, CoverUrls | null>;
  onTagClick: (tag: string) => void;
}

interface HoveredRow {
  id: number;
}

/** 行 hover 后延迟打开：快速划过不逐个发请求。 */
const OPEN_DELAY_MS = 150;
/** 离开行 / 面板后的延迟关闭，给指针移动到面板留出时间。 */
const CLOSE_DELAY_MS = 120;
/** 窄屏不展示预览，避免遮挡内容。 */
const PREVIEW_MIN_WIDTH = 768;

/** 仅桌面指针设备（`hover: hover`）且宽度 ≥768px 时启用悬浮预览。 */
function useHoverPreviewEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const hoverQuery = window.matchMedia("(hover: hover)");
    const update = () => {
      setEnabled(hoverQuery.matches && window.innerWidth >= PREVIEW_MIN_WIDTH);
    };
    update();
    hoverQuery.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      hoverQuery.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return enabled;
}

/**
 * 结果列表：行卡片 + 至多一个悬浮预览。
 *
 * 预览状态集中在这里（同一时刻只显示一个），打开/关闭都走 150ms/120ms 计时；
 * 指针进入面板时 `keepAlive` 取消关闭，离开面板再重新计时。
 */
export function ResultList({ items, covers, onTagClick }: ResultListProps) {
  const previewEnabled = useHoverPreviewEnabled();
  const [hovered, setHovered] = useState<HoveredRow | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleOpen = useCallback(
    (id: number) => {
      clearOpenTimer();
      clearCloseTimer();
      openTimerRef.current = window.setTimeout(() => {
        openTimerRef.current = null;
        setHovered({ id });
      }, OPEN_DELAY_MS);
    },
    [clearCloseTimer, clearOpenTimer],
  );

  const scheduleClose = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setHovered(null);
    }, CLOSE_DELAY_MS);
  }, [clearCloseTimer, clearOpenTimer]);

  const keepAlive = useCallback(() => {
    clearCloseTimer();
    clearOpenTimer();
  }, [clearCloseTimer, clearOpenTimer]);

  // 筛选 / 翻页换了一批结果：立即收起旧预览，避免面板内容与行错位。
  useEffect(() => {
    setHovered(null);
  }, [items]);

  // 切到窄屏或触屏（media query / resize 变化）时停用。
  useEffect(() => {
    if (previewEnabled) return;
    clearOpenTimer();
    clearCloseTimer();
    setHovered(null);
  }, [previewEnabled, clearCloseTimer, clearOpenTimer]);

  // 卸载时清掉计时器，避免对已卸载组件 setState。
  useEffect(
    () => () => {
      clearOpenTimer();
      clearCloseTimer();
    },
    [clearCloseTimer, clearOpenTimer],
  );

  // 页面滚动 / resize 时面板位置可能失效：取消「还没打开」的计时；
  // 已打开的面板由 HoverPreview 自己监听 scroll/resize 关闭（并忽略面板内部滚动）。
  useEffect(() => {
    const cancelPendingOpen = () => {
      if (openTimerRef.current !== null) {
        window.clearTimeout(openTimerRef.current);
        openTimerRef.current = null;
      }
    };
    const handleScroll = (event: Event) => {
      const panel = document.querySelector("[data-hover-preview]");
      if (panel && event.target instanceof Node && panel.contains(event.target)) return;
      cancelPendingOpen();
    };
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", cancelPendingOpen);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", cancelPendingOpen);
    };
  }, []);

  const hoveredSubject = hovered ? items.find((item) => item.id === hovered.id) : undefined;

  return (
    <>
      <ul className="divide-y divide-slate-100" aria-label="条目结果">
        {items.map((subject) => (
          <SubjectCard
            key={subject.id}
            subject={subject}
            cover={covers[String(subject.id)] ?? null}
            onTagClick={onTagClick}
            onHover={previewEnabled ? () => scheduleOpen(subject.id) : undefined}
            onLeave={previewEnabled ? scheduleClose : undefined}
          />
        ))}
      </ul>

      {previewEnabled && hovered && hoveredSubject && (
        <HoverPreview
          subject={{
            id: hoveredSubject.id,
            name: hoveredSubject.name,
            type: hoveredSubject.type,
            year: hoveredSubject.year,
            date: hoveredSubject.date,
          }}
          onKeepAlive={keepAlive}
          onRequestClose={scheduleClose}
        />
      )}
    </>
  );
}
