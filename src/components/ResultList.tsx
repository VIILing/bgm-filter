"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SubjectDialog } from "~/components/SubjectDialog";
import { SubjectCard } from "~/components/SubjectCard";
import type { CoverUrls, SubjectCardDto } from "~/shared/subject-contract";

export interface ResultListProps {
  items: SubjectCardDto[];
  /** 以字符串 id 为键的封面 URL；缺失 / null 时卡片显示占位块。 */
  covers: Record<string, CoverUrls | null>;
  onTagClick: (tag: string) => void;
}

/** <768 不启用弹窗，点击行沿用原始 target=_blank 跳转。 */
const DIALOG_MIN_WIDTH = 768;
/** 关闭动画 140ms；多留 10ms 让动画播完再卸载。 */
const CLOSE_ANIMATION_MS = 150;

interface OpenDialog {
  subject: SubjectCardDto;
  trigger: HTMLElement;
}

/** ≥768 且鼠标设备（hover:hover / pointer:fine）才启用点击弹窗。 */
function useDialogEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const hoverQuery = window.matchMedia("(hover: hover)");
    const finePointerQuery = window.matchMedia("(pointer: fine)");
    const update = () => {
      setEnabled(
        hoverQuery.matches && finePointerQuery.matches && window.innerWidth >= DIALOG_MIN_WIDTH,
      );
    };
    update();
    hoverQuery.addEventListener("change", update);
    finePointerQuery.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      hoverQuery.removeEventListener("change", update);
      finePointerQuery.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return enabled;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * 结果列表：行卡片 + 至多一个点击弹窗。
 *
 * - 悬浮只保留行高亮，不发 preview/summary/原图请求；
 * - 点击整卡（标签 chip 除外）打开唯一弹窗；<768 / 触屏不拦截，保留 target=_blank；
 * - 关闭动画 150ms 后再卸载；关闭后焦点回触发行（行已移除则回结果列表）。
 */
export function ResultList({ items, covers, onTagClick }: ResultListProps) {
  const dialogEnabled = useDialogEnabled();
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [closing, setClosing] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const dialogRef = useRef<OpenDialog | null>(null);
  const closingRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const lastTriggerRef = useRef<HTMLElement | null>(null);
  // 只在「结果集真的换了」时关闭；窗口重新聚焦触发的同结果 refetch 不应关弹窗。
  const itemsKey = useMemo(() => items.map((item) => item.id).join(","), [items]);
  const itemsKeyRef = useRef(itemsKey);

  dialogRef.current = dialog;

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const openDialog = useCallback((subject: SubjectCardDto, trigger: HTMLElement) => {
    clearCloseTimer();
    closingRef.current = false;
    setClosing(false);
    setDialog({ subject, trigger });
  }, [clearCloseTimer]);

  const closeDialog = useCallback(() => {
    if (!dialogRef.current || closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    const delay = prefersReducedMotion() ? 0 : CLOSE_ANIMATION_MS;
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      closingRef.current = false;
      setDialog(null);
      setClosing(false);
    }, delay);
  }, []);

  // 筛选 / 翻页 / 结果集变化：关闭弹窗（内容与行已不对应）。
  useEffect(() => {
    if (itemsKeyRef.current === itemsKey) return;
    itemsKeyRef.current = itemsKey;
    closeDialog();
  }, [itemsKey, closeDialog]);

  // 缩到 <768 或切到触屏：关闭弹窗。
  useEffect(() => {
    if (dialogEnabled) return;
    closeDialog();
  }, [dialogEnabled, closeDialog]);

  // 关闭动画结束、弹窗卸载后再还原焦点（此时背景已解除 inert）。
  useEffect(() => {
    if (dialog !== null) return;
    const trigger = lastTriggerRef.current;
    if (!trigger) return;
    lastTriggerRef.current = null;
    if (trigger.isConnected) trigger.focus({ preventScroll: true });
    else listRef.current?.focus({ preventScroll: true });
  }, [dialog]);

  // 卸载时清掉关闭计时器，避免对已卸载组件 setState。
  useEffect(
    () => () => {
      clearCloseTimer();
    },
    [clearCloseTimer],
  );

  const handleOpen = useCallback(
    (subject: SubjectCardDto) => (trigger: HTMLElement) => {
      lastTriggerRef.current = trigger;
      openDialog(subject, trigger);
    },
    [openDialog],
  );

  return (
    <>
      <ul
        ref={listRef}
        tabIndex={-1}
        className="divide-y divide-slate-100 outline-none"
        aria-label="条目结果"
      >
        {items.map((subject) => (
          <SubjectCard
            key={subject.id}
            subject={subject}
            cover={covers[String(subject.id)] ?? null}
            onTagClick={onTagClick}
            dialogEnabled={dialogEnabled}
            onOpen={dialogEnabled ? handleOpen(subject) : undefined}
          />
        ))}
      </ul>

      {dialog && (
        <SubjectDialog
          subject={{
            id: dialog.subject.id,
            name: dialog.subject.name,
            nameCn: dialog.subject.nameCn,
            type: dialog.subject.type,
            year: dialog.subject.year,
            date: dialog.subject.date,
            score: dialog.subject.score,
            scoreVotes: dialog.subject.scoreVotes,
            rank: dialog.subject.rank,
          }}
          // undefined = 该块封面尚未加载（弹窗按单 id 兜底查询）；null = 已确认无封面。
          cover={covers[String(dialog.subject.id)]}
          closing={closing}
          onClose={closeDialog}
        />
      )}
    </>
  );
}
