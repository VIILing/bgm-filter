/** 数字/年份/评分的展示格式化（纯函数）。 */

function groupThousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * 条目数/人数格式化：10000 以下用千分位（9,999），
 * 10000 及以上用「万」（1.2万 / 10万）。
 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 10_000) return groupThousands(value);
  const wan = Math.round((value / 10_000) * 10) / 10;
  return Number.isInteger(wan) ? `${wan.toFixed(0)}万` : `${wan.toFixed(1)}万`;
}

/** 评分保留 1 位小数；0 / 非数字 = 无评分。 */
export function formatScore(score: number): string {
  if (!Number.isFinite(score) || score <= 0) return "无评分";
  return score.toFixed(1);
}

/** 优先展示原始日期（如 2002-10-01），否则年份，均无则「—」。 */
export function formatYear(year: number | null, date?: string | null): string {
  const trimmedDate = date?.trim();
  if (trimmedDate) return trimmedDate;
  if (year !== null && Number.isInteger(year) && year > 0) return String(year);
  return "—";
}
