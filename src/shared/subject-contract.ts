import { z } from "zod";

export const SUBJECT_TYPES = [
  { value: 1, label: "漫画" },
  { value: 2, label: "动画" },
  { value: 3, label: "音乐" },
  { value: 4, label: "游戏" },
  { value: 6, label: "三次元" },
] as const;

export const TYPE_LABEL: Record<number, string> = { 1: "漫画", 2: "动画", 3: "音乐", 4: "游戏", 6: "三次元" };

export const searchInputSchema = z.object({
  tagExpr: z.string().max(500).default(""),
  q: z.string().max(100).default(""),
  types: z.array(z.number().int()).optional(),          // undefined/[] → 全选
  yearFrom: z.number().int().min(1000).max(2100).nullable().optional(),
  yearTo: z.number().int().min(1000).max(2100).nullable().optional(),
  sort: z.enum(["weighted_desc", "score_desc", "score_asc"]).default("weighted_desc"),
  scoreless: z.enum(["last", "first"]).default("last"),
  page: z.number().int().min(1).default(1),
});
export type SearchInput = z.infer<typeof searchInputSchema>;

export interface SubjectCardDto {
  id: number;
  type: number;
  name: string;
  nameCn: string | null;
  date: string | null;
  year: number | null;
  score: number;        // 0 = 无评分
  scoreVotes: number;
  rank: number | null;
  nsfw: boolean;
  tags: string[];       // 展示用，最多 8 个
  favoriteDone: number; // 没有 favorite 时为 0
}

export interface SearchResultDto {
  items: SubjectCardDto[];
  total: number;
  page: number;
  pageSize: number;   // 固定 50
  totalPages: number;
  warnings: string[]; // 例如 ["未知标签：foo"]
  parsedTags: string[]; // 表达式中出现的已知标签规范名
}

export interface TagSuggestionDto {
  name: string;
  count: number;
}

export interface StatsDto {
  total: number;
  taggedTotal: number;
  types: { type: number; count: number }[];
}

export const PAGE_SIZE = 50;

/** 悬浮预览里的一个带计数标签（来自 `tagsJson`，按 count 降序）。 */
export interface SubjectPreviewTag {
  name: string;
  count: number;
}

/** 悬浮预览数据：用户标签（带计数）+ 公共标签（无计数）；简介走 `subject.summary` 懒加载。 */
export interface SubjectPreviewDto {
  id: number;
  tags: SubjectPreviewTag[];
  metaTags: string[];
}

/** 简介懒加载结果；`summary=null` 表示无简介（404/空/失败统一降级）。 */
export interface SubjectSummaryDto {
  id: number;
  summary: string | null;
}

/**
 * 卡片封面 URL。三个尺寸都由官方 API 的 `images` 原样取用：
 * grid = /r/100、small = /r/200、common = /r/400；浏览器直连 lain.bgm.tv。
 */
export interface CoverUrls {
  grid: string;
  small: string;
  common: string;
}

/** 单次 `subject.covers` 允许的最大 id 数（与搜索页每页条目数一致）。 */
export const COVER_IDS_MAX = 50;
