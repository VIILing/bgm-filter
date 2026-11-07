/** 悬浮预览面板的纯函数辅助：封面回退链与元信息文案。 */

import type { CoverUrls } from "~/shared/subject-contract";

import { formatCount } from "./format";

/**
 * 按 `large → common → small → grid` 生成封面候选 URL。
 *
 * - `cover` 为 `null`（无封面）或 `undefined`（数据未到）时返回 `[]`；
 * - `large` 为 `null`（旧缓存无法推导原图）时自然跳过，从 `common` 开始；
 * - 去重并过滤空串，保证同一 URL 不会在回退链里被请求两次。
 *
 * 服务端已对旧缓存做 v5 迁移与推导，前端只按顺序回退，不感知缓存版本。
 */
export function buildCoverCandidates(cover: CoverUrls | null | undefined): string[] {
  if (!cover) return [];

  const result: string[] = [];
  const seen = new Set<string>();
  const ordered: (string | null | undefined)[] = [cover.large, cover.common, cover.small, cover.grid];

  for (const url of ordered) {
    if (typeof url !== "string") continue;
    const trimmed = url.trim();
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

/**
 * 元信息第 3 行（≥1024）的「人数 · 排名」文案。
 *
 * - 人数用 `formatCount`（1.2万 人）；
 * - rank 为 null / 0 / 非正整数时不显示排名；
 * - 两者都缺失时用 `—` 占位，保持行高稳定。
 */
export function formatVotesRank(scoreVotes: number, rank: number | null): string {
  const votes = Number.isFinite(scoreVotes) && scoreVotes > 0 ? Math.round(scoreVotes) : 0;
  const hasRank = rank !== null && Number.isInteger(rank) && rank > 0;

  if (votes <= 0 && !hasRank) return "—";

  const votesText = `${formatCount(votes)}人评分`;
  return hasRank ? `${votesText} · 排名 #${rank}` : votesText;
}
