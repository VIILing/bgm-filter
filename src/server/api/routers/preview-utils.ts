/**
 * `subject.preview` 的数据清洗（纯函数，便于单测）。
 *
 * dump 里的 `tagsJson` 形如 `[{"name":"井上雄彦","count":575}, ...]`，导入时已按
 * count 降序；但历史/脏数据可能不是数组、缺字段或大小写重复。这里统一容错：
 * - 解析失败 / 不是数组 → 空数组，绝不抛错（预览失败不能影响搜索结果）；
 * - 同名（大小写不敏感）去重，保留首次出现的写法与计数；
 * - 最终按 count 降序，count 相同保持原顺序（`Array.prototype.sort` 稳定）。
 */

import type { SubjectPreviewTag } from "~/shared/subject-contract";

function normalizeCount(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.trunc(numeric);
}

/** 解析 `tagsJson` → 去重、按 count 降序的标签列表（无计数按 0）。 */
export function parsePreviewTags(tagsJson: string | null): SubjectPreviewTag[] {
  if (typeof tagsJson !== "string" || tagsJson.length === 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(tagsJson);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const tags: SubjectPreviewTag[] = [];
  for (const item of parsed) {
    if (item === null || typeof item !== "object") continue;
    const rawName = (item as { name?: unknown }).name;
    if (typeof rawName !== "string") continue;
    const name = rawName.trim();
    if (name.length === 0) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    tags.push({ name, count: normalizeCount((item as { count?: unknown }).count) });
  }

  return tags.sort((a, b) => b.count - a.count);
}

/** 解析 `metaTagsJson`（公共标签，字符串数组）：去重、去空白，保留原顺序。 */
export function parsePreviewMetaTags(metaTagsJson: string | null): string[] {
  if (typeof metaTagsJson !== "string" || metaTagsJson.length === 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(metaTagsJson);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (name.length === 0) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(name);
  }
  return tags;
}
