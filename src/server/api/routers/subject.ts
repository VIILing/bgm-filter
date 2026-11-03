import { z } from "zod";

import {
  searchInputSchema,
  type SearchResultDto,
  type StatsDto,
  type TagSuggestionDto,
} from "~/shared/subject-contract";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  getSubjectStats,
  searchSubjects,
  searchTags,
} from "~/server/search/subject-search";

/**
 * 标签联想 / 常用标签：q 为空 → 按 count 倒序的常用标签（F8）。
 * 上限 50 与搜索页每页条目数一致，避免前端一次拉太多。
 */
const tagQuerySchema = z.object({
  q: z.string().max(100).default(""),
  limit: z.number().int().min(1).max(50).default(20),
});

export const subjectRouter = createTRPCRouter({
  /**
   * 主搜索。标签表达式语法错误 / 年份区间非法 → BAD_REQUEST（含位置提示）；
   * 数据库不可用 → INTERNAL_SERVER_ERROR（含 `pnpm db:import` 提示）。
   */
  search: publicProcedure
    .input(searchInputSchema)
    .query(({ input, ctx }): Promise<SearchResultDto> =>
      searchSubjects(input, ctx.db),
    ),

  /** 标签联想 / 常用标签。 */
  tags: publicProcedure
    .input(tagQuerySchema)
    .query(({ input, ctx }): Promise<TagSuggestionDto[]> =>
      searchTags(input, ctx.db),
    ),

  /** 头部统计：总条目、有标签条目数、各类型条目数。 */
  stats: publicProcedure.query(({ ctx }): Promise<StatsDto> =>
    getSubjectStats(ctx.db),
  ),
});
