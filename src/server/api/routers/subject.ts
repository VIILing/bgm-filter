import { z } from "zod";

import {
  COVER_IDS_MAX,
  type CoverUrls,
  searchInputSchema,
  type SearchResultDto,
  type StatsDto,
  type SubjectPreviewDto,
  type SubjectSummaryDto,
  type TagSuggestionDto,
} from "~/shared/subject-contract";
import { parsePreviewMetaTags, parsePreviewTags } from "~/server/api/routers/preview-utils";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { getCovers, getSummary } from "~/server/cover/cover-service";
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

  /**
   * 悬浮预览：用户标签（带计数，来自 tagsJson）+ 公共标签（metaTagsJson）。
   * 仅在鼠标悬浮行时按需请求；找不到条目返回 null。
   * 简介不再随本接口返回，改由 `subject.summary` 懒加载。
   * tagsJson 解析失败按空数组处理（`parsePreviewTags`），不抛错影响列表。
   */
  preview: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }): Promise<SubjectPreviewDto | null> => {
      const row = await ctx.db.subject.findUnique({
        where: { id: input.id },
        select: { tagsJson: true, metaTagsJson: true },
      });
      if (!row) return null;

      return {
        id: input.id,
        tags: parsePreviewTags(row.tagsJson),
        metaTags: parsePreviewMetaTags(row.metaTagsJson),
      };
    }),

  /**
   * 简介懒加载：缓存（cover_cache）命中优先 → 未命中 getSubject 回源（与封面同源）。
   * 永不抛错；404 / 网络 / 熔断 / 空 → `summary:null`。
   */
  summary: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }): Promise<SubjectSummaryDto> => ({
      id: input.id,
      summary: await getSummary(input.id),
    })),

  /**
   * 批量取封面 URL（最多 50 个 id，可重复/含非法值，服务端会清洗）。
   * 每项为 `{grid, small, common, large}`：large 是原图（无 `/r/` 前缀），
   * 旧缓存行可推导时同样返回，无法推导为 null；无封面/失败/NSFW 均为 null。
   * 只返回 URL，图片由浏览器直连 lain.bgm.tv；外部请求统一走 `bgmClient`。
   */
  covers: publicProcedure
    .input(
      z.object({
        ids: z.array(z.number().int().positive()).max(COVER_IDS_MAX),
      }),
    )
    .query(
      ({ input }): Promise<Record<string, CoverUrls | null>> =>
        getCovers(input.ids),
    ),
});
