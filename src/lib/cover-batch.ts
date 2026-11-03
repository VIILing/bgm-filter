import { COVER_IDS_MAX } from "~/shared/subject-contract";

/** 默认每块 id 数：服务端 ≈2 req/s，10 个约 5s，渐进式补图不至于等整页。 */
export const DEFAULT_COVER_CHUNK_SIZE = 10;

/**
 * 把当前页的条目 id 切成若干块，供 `subject.covers` 分批请求。
 *
 * - 过滤非正整数（含 NaN / Infinity / 小数）并去重，保留首次出现的顺序；
 * - `size` 夹取到 `[1, COVER_IDS_MAX]`（服务端单次上限 50），非有限数回退默认值；
 * - 空输入返回 `[]`，不产生空块。
 *
 * 纯函数，无副作用，供 HomeClient 与单测共用。
 */
export function chunkCoverIds(
  ids: readonly number[],
  size: number = DEFAULT_COVER_CHUNK_SIZE,
): number[][] {
  const chunkSize = normalizeChunkSize(size);
  const seen = new Set<number>();
  const chunks: number[][] = [];
  let current: number[] = [];

  for (const id of ids) {
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    current.push(id);
    if (current.length === chunkSize) {
      chunks.push(current);
      current = [];
    }
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

function normalizeChunkSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_COVER_CHUNK_SIZE;
  const integer = Math.floor(size);
  if (integer < 1) return 1;
  return Math.min(integer, COVER_IDS_MAX);
}
