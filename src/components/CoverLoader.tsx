"use client";

import { useEffect } from "react";

import type { CoverUrls } from "~/shared/subject-contract";
import { trpc } from "~/trpc/react";

export type CoverMap = Record<string, CoverUrls | null>;

const EMPTY_COVER_MAP: CoverMap = {};

export interface CoverLoaderProps {
  /** 本块最多 10 个 id。 */
  ids: number[];
  /** 当前结果集的稳定标识；父级用它丢弃上一页/上一筛选的迟到结果。 */
  batchKey: string;
  /** 块序号（0 起），用于父级记录哪些块已完成。 */
  index: number;
  /**
   * 是否启用本块查询。父级在前一块完成后再启用下一块：
   * 既保证封面每 ~5s 渐进出 10 张，也避免 httpBatchLink 把多块并发查询
   * 合并成一个 HTTP 响应、等最慢的 25s 才一次性返回。
   */
  enabled: boolean;
  /** 成功或失败都会回调；父级只合并数据，不展示错误。 */
  onLoaded: (batchKey: string, index: number, covers: CoverMap) => void;
}

/**
 * 单个封面分块加载器：一个实例只发一个 `subject.covers({ ids })` 查询。
 *
 * 每块一个组件实例，避免在循环 / 条件分支里调用 `useQuery`，也满足 hooks 规则；
 * 页面最多渲染 5 个（50 / 10）。组件不渲染任何 DOM。
 */
export function CoverLoader({ ids, batchKey, index, enabled, onLoaded }: CoverLoaderProps) {
  const query = trpc.subject.covers.useQuery(
    { ids },
    {
      enabled: enabled && ids.length > 0,
      staleTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      // 服务端本身永不抛错（失败返回 null）；网络层失败时直接降级占位，不重试。
      retry: false,
    },
  );

  const { data, isError } = query;

  useEffect(() => {
    if (data !== undefined) {
      onLoaded(batchKey, index, data);
    } else if (isError) {
      onLoaded(batchKey, index, EMPTY_COVER_MAP);
    }
  }, [data, isError, batchKey, index, onLoaded]);

  return null;
}
