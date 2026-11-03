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
  sort: z.enum(["score_desc", "score_asc"]).default("score_desc"),
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
