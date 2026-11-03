import { z } from "zod";

import {
  PAGE_SIZE,
  searchInputSchema,
  type SearchResultDto,
  type TagSuggestionDto,
} from "~/shared/subject-contract";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

/**
 * S1 占位实现：只保证 tRPC 链路与契约 shape 正确，返回空数据。
 * S3（api-engineer）将用 tag-dsl + subject-search 重写本文件。
 */
export interface StatsDto {
  total: number;
  taggedTotal: number;
  types: { type: number; count: number }[];
}

export const subjectRouter = createTRPCRouter({
  /** 主搜索：输入解析错误 → TRPCError code "BAD_REQUEST"（S3 实现）。 */
  search: publicProcedure
    .input(searchInputSchema)
    .query((): SearchResultDto => {
      return {
        items: [],
        total: 0,
        page: 1,
        pageSize: PAGE_SIZE,
        totalPages: 1,
        warnings: [],
        parsedTags: [],
      };
    }),

  /** 标签联想/常用标签：q 为空 → 按 count 倒序的常用标签。 */
  tags: publicProcedure
    .input(
      z.object({
        q: z.string().max(100).default(""),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query((): TagSuggestionDto[] => {
      return [];
    }),

  /** 头部统计：总条目、有标签条目数、各类型条目数。 */
  stats: publicProcedure.query((): StatsDto => {
    return {
      total: 0,
      taggedTotal: 0,
      types: [],
    };
  }),
});
