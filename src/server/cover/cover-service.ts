/**
 * 封面 URL + 简介解析服务。
 *
 * 产品决策：只解析并缓存「id → {grid,small,common,large} URL」与「id → summary 简介」，
 * 图片字节一律不落盘、不经服务端代理，由浏览器直连 `lain.bgm.tv`。本模块只有
 * 字符串级缓存，且**永不向前端抛错**：任何外部/缓存异常都降级为 `null`。
 *
 * summary 与封面同源：`getSubject(id)` 一次返回 `images` 与 `summary`，二者写进
 * 同一条 cover_cache 行；`getCovers` 取图时顺带缓存 summary（封面加载即预热简介），
 * `getSummary` 命中缓存时零外呼。
 *
 * 所有 Bangumi 外部请求（UA / token / 超时 / 限速 / 并发 / 重试 / 熔断）都委托给
 * `~/server/bgm/bgm-client`，本模块只保留输入清洗、缓存读写与字段容错。
 */

import {
  BgmCircuitOpenError,
  BgmHttpError,
  bgmClient,
  type BgmClient,
  type BgmSubject,
} from "~/server/bgm/bgm-client";

import {
  COVER_IDS_MAX,
  type CoverUrls,
} from "~/shared/subject-contract";

import {
  CoverCache,
  DEFAULT_COVER_CACHE_PATH,
  deriveLargeUrl,
  type CoverCacheWrite,
} from "./cover-cache";

/** 负缓存 TTL：200 但无图 / unknown（7 天）。404 单独 1 天，便于补 token 后重试。 */
export const COVER_NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 上游 404 的负缓存 TTL：NSFW 未认证也返回 404，配 token 后 1 天内可自动重试。 */
export const COVER_NOT_FOUND_TTL_MS = 24 * 60 * 60 * 1000;

/** 封面服务所需的最小客户端能力（便于测试注入 fake）。 */
export type CoverClient = Pick<BgmClient, "getSubject">;

/** 可注入时钟，便于单测虚拟时间（缓存 TTL）。 */
export interface CoverClock {
  now(): number;
}

export interface CoverServiceOptions {
  /** 默认生产单例 `bgmClient`；测试注入 fake，绝不联网。 */
  client?: CoverClient;
  clock?: CoverClock;
  /** 默认 `.cache/covers.db`；测试用 `:memory:`。 */
  cachePath?: string;
  negativeTtlMs?: number;
  /** 404 负缓存 TTL（默认 1 天）。 */
  notFoundTtlMs?: number;
  /** 日志出口；默认 `console.warn`，只在失败/熔断时调用。 */
  warn?: (message: string, error?: unknown) => void;
}

/** 单次调用可临时覆盖客户端（默认用构造时注入的那个）。 */
export interface CoverServiceDeps {
  client?: CoverClient;
}

export interface CoverService {
  getCovers(
    ids: number[],
    deps?: CoverServiceDeps,
  ): Promise<Record<string, CoverUrls | null>>;
  /** 单条简介懒加载；`null` = 无简介 / 404 / 失败。永不抛错。 */
  getSummary(id: number, deps?: CoverServiceDeps): Promise<string | null>;
  close(): void;
}

interface FetchOutcome {
  urls: CoverUrls | null;
  /** 简介（`null` = 无简介 / 404 / 失败）；与 urls 来自同一次 getSubject。 */
  summary: string | null;
  /** `true` = 确定结果（有封面 / 无封面 / 404），可写缓存。 */
  cacheable: boolean;
  /** 负缓存原因：404 与 200 无图使用不同 TTL。 */
  reason?: "ok" | "no_image" | "not_found";
  /** 重试后仍失败（网络/超时/5xx），不写缓存。 */
  failed: boolean;
  /** 因熔断已打开/半开而被跳过，未发外部请求。 */
  skipped: boolean;
}

const realClock: CoverClock = {
  now: () => Date.now(),
};

/**
 * 纯函数：把官方 `images`（或缓存行）转成契约里的四尺寸 URL。
 *
 * 容错空字符串 / null / 非字符串 / 缺字段：任一尺寸缺失时用其它可用尺寸顶替
 * （grid → small → common；common → small → grid），全空返回 null。
 * `large` 优先取官方值；缺失时从 common（其次 small/grid）安全推导，
 * 推导失败保持 null（前端回退到较小尺寸）。
 */
export function pickCoverUrls(images: unknown): CoverUrls | null {
  if (images === null || typeof images !== "object") return null;
  const record = images as Record<string, unknown>;
  const grid = readUrl(record.grid);
  const small = readUrl(record.small);
  const common = readUrl(record.common);
  if (!grid && !small && !common) return null;

  return {
    grid: grid ?? small ?? common!,
    small: small ?? common ?? grid!,
    common: common ?? small ?? grid!,
    large: readUrl(record.large) ?? deriveLargeUrl(common ?? small ?? grid),
  };
}

/**
 * 纯函数：从官方 subject 响应取简介。容错缺失 / 非字符串 / 空白 → null（无简介）。
 */
export function pickSummary(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 去重、过滤非正整数、截断到 50（先清洗再截断，避免重复 id 占额度）。 */
function sanitizeIds(ids: readonly number[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const id of ids) {
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= COVER_IDS_MAX) break;
  }
  return result;
}

class CoverServiceEngine implements CoverService {
  private readonly client: CoverClient;
  private readonly clock: CoverClock;
  private readonly cachePath: string;
  private readonly negativeTtlMs: number;
  private readonly notFoundTtlMs: number;
  private readonly warn: (message: string, error?: unknown) => void;

  private cache: CoverCache | null = null;
  private cacheFailed = false;

  constructor(options: CoverServiceOptions) {
    this.client = options.client ?? bgmClient;
    this.clock = options.clock ?? realClock;
    this.cachePath = options.cachePath ?? DEFAULT_COVER_CACHE_PATH;
    this.negativeTtlMs = options.negativeTtlMs ?? COVER_NEGATIVE_TTL_MS;
    this.notFoundTtlMs = options.notFoundTtlMs ?? COVER_NOT_FOUND_TTL_MS;
    this.warn =
      options.warn ??
      ((message, error) => {
        if (error === undefined) console.warn(message);
        else console.warn(message, error);
      });
  }

  async getCovers(
    ids: number[],
    deps: CoverServiceDeps = {},
  ): Promise<Record<string, CoverUrls | null>> {
    const uniqueIds = sanitizeIds(ids);
    if (uniqueIds.length === 0) return {};

    try {
      return await this.resolveCovers(
        uniqueIds,
        deps.client ?? this.client,
      );
    } catch (error) {
      // 兜底：缓存/解析/任何意外都不允许把错误抛给前端。
      this.warn("[cover] 封面解析整体失败，本批降级为无封面", error);
      return toRecord(uniqueIds, new Map());
    }
  }

  async getSummary(
    id: number,
    deps: CoverServiceDeps = {},
  ): Promise<string | null> {
    if (!Number.isSafeInteger(id) || id <= 0) return null;

    try {
      return await this.resolveSummary(id, deps.client ?? this.client);
    } catch (error) {
      // 永不抛错：缓存/解析/任何意外都降级为 null（前端显示「暂无简介」）。
      this.warn("[cover] 简介解析失败，降级为 null", error);
      return null;
    }
  }

  close(): void {
    try {
      this.cache?.close();
    } catch {
      // 已关闭 / 句柄异常，忽略
    }
    this.cache = null;
    this.cacheFailed = true;
  }

  private async resolveCovers(
    ids: readonly number[],
    client: CoverClient,
  ): Promise<Record<string, CoverUrls | null>> {
    const now = this.clock.now();
    const resolved = new Map<number, CoverUrls | null>();

    // 1) 本地缓存（含负缓存）。产品已取消封面 NSFW 限制，NSFW id 与普通 id 同路径。
    const cache = this.getCache();
    if (cache) {
      try {
        for (const [id, entry] of cache.getMany(
          ids,
          now,
          this.negativeTtlMs,
          this.notFoundTtlMs,
        )) {
          // 正缓存但 large 为空（v4 旧行的 common 无法安全推导）：不视为最终命中，
          // 走一次正常回源补齐原图；负缓存（missing）语义完全不变。
          if (!entry.missing && entry.large === null) continue;
          resolved.set(id, entry.missing ? null : pickCoverUrls(entry));
        }
      } catch (error) {
        this.warn("[cover] 读取封面缓存失败，继续回源", error);
      }
    }

    const fetchable = ids.filter((id) => !resolved.has(id));
    if (fetchable.length === 0) return toRecord(ids, resolved);

    // 2) 只对缓存未命中的条目回源；单条失败不影响其它 id。
    //    限速/重试/熔断由 BgmClient 统一处理（熔断打开时这里会收到 skipped）。
    const outcomes = await Promise.all(
      fetchable.map(async (id) => ({
        id,
        outcome: await this.fetchOne(id, client),
      })),
    );
    const writes: CoverCacheWrite[] = [];
    for (const { id, outcome } of outcomes) {
      resolved.set(id, outcome.urls);
      if (outcome.cacheable) {
        writes.push({
          id,
          urls: outcome.urls,
          summary: outcome.summary,
          fetchedAt: this.clock.now(),
          reason: outcome.reason,
        });
      }
    }

    this.warnFailureSummary(outcomes, fetchable.length);
    this.writeCache(writes);
    return toRecord(ids, resolved);
  }

  /**
   * 取单条简介：缓存优先（summaryFetched=1 时命中，即使 summary 为 null），
   * 未命中 / 旧正缓存（summaryFetched=0）则回源一次 getSubject，与封面一起写缓存。
   */
  private async resolveSummary(
    id: number,
    client: CoverClient,
  ): Promise<string | null> {
    const now = this.clock.now();
    const cache = this.getCache();
    if (cache) {
      try {
        const entry = cache
          .getMany([id], now, this.negativeTtlMs, this.notFoundTtlMs)
          .get(id);
        // 正缓存行若缺 large（v4 旧行无法推导），顺带回源一次补齐原图；
        // 负缓存行（missing）保持原语义，直接返回已定论的 summary。
        if (entry && entry.summaryFetched && (entry.missing || entry.large !== null)) {
          return entry.summary;
        }
      } catch (error) {
        this.warn("[cover] 读取简介缓存失败，继续回源", error);
      }
    }

    const outcome = await this.fetchOne(id, client);
    if (outcome.cacheable) {
      this.writeCache([
        {
          id,
          urls: outcome.urls,
          summary: outcome.summary,
          fetchedAt: this.clock.now(),
          reason: outcome.reason,
        },
      ]);
    }
    return outcome.summary;
  }

  /** 单批只打一行汇总，避免逐条刷屏；失败不写缓存，下次仍可重试。 */
  private warnFailureSummary(
    outcomes: ReadonlyArray<{ id: number; outcome: FetchOutcome }>,
    total: number,
  ): void {
    const failed = outcomes.filter((item) => item.outcome.failed).length;
    const skipped = outcomes.filter((item) => item.outcome.skipped).length;
    if (failed === 0 && skipped === 0) return;
    this.warn(
      `[cover] 本批 ${failed}/${total} 条失败（未写缓存、下次可重试），` +
        `${skipped} 条因熔断跳过`,
    );
  }

  /**
   * 取单条封面：`getSubject` 内部已完成重试/熔断；这里只把结果映射成
   * 「可缓存 / 失败 / 跳过」三种状态，错误全部吞掉。
   */
  private async fetchOne(
    id: number,
    client: CoverClient,
  ): Promise<FetchOutcome> {
    try {
      const subject: BgmSubject | null = await client.getSubject(id);
      if (subject === null) {
        // 404 是确定结果：写 1 天负缓存，便于补 token 后重试；summary 置空。
        return this.outcome(null, null, true, false, false, "not_found");
      }
      const urls = pickCoverUrls(subject.images);
      const summary = pickSummary(subject.summary);
      return this.outcome(
        urls,
        summary,
        true,
        false,
        false,
        urls ? "ok" : "no_image",
      );
    } catch (error) {
      if (error instanceof BgmCircuitOpenError) {
        // 熔断短路：没发外部请求，不能当成「无图」写缓存。
        return this.outcome(null, null, false, true, true);
      }
      // 兼容客户端直接把 404 作为异常抛出的实现（默认 getSubject 已映射为 null）。
      if (error instanceof BgmHttpError && error.status === 404) {
        return this.outcome(null, null, true, false, false, "not_found");
      }
      return this.outcome(null, null, false, true, false);
    }
  }

  private outcome(
    urls: CoverUrls | null,
    summary: string | null,
    cacheable: boolean,
    failed: boolean,
    skipped: boolean,
    reason?: "ok" | "no_image" | "not_found",
  ): FetchOutcome {
    return { urls, summary, cacheable, failed, skipped, reason };
  }

  private getCache(): CoverCache | null {
    if (this.cache || this.cacheFailed) return this.cache;
    try {
      this.cache = new CoverCache(this.cachePath);
    } catch (error) {
      this.cacheFailed = true;
      this.warn("[cover] 打开封面缓存失败，本次不缓存", error);
    }
    return this.cache;
  }

  private writeCache(entries: readonly CoverCacheWrite[]): void {
    if (entries.length === 0) return;
    const cache = this.getCache();
    if (!cache) return;
    try {
      cache.setMany(entries);
    } catch (error) {
      this.warn("[cover] 写入封面缓存失败", error);
    }
  }
}

function toRecord(
  ids: readonly number[],
  values: ReadonlyMap<number, CoverUrls | null>,
): Record<string, CoverUrls | null> {
  const record: Record<string, CoverUrls | null> = {};
  for (const id of ids) {
    record[String(id)] = values.get(id) ?? null;
  }
  return record;
}

/** 创建独立实例（测试注入 fake client / 假时钟 / 内存缓存）。 */
export function createCoverService(
  options: CoverServiceOptions = {},
): CoverService {
  return new CoverServiceEngine(options);
}

let defaultService: CoverService | null = null;

function getDefaultService(): CoverService {
  if (!defaultService) defaultService = createCoverService();
  return defaultService;
}

/**
 * 生产入口。tRPC router 调用；永不抛错。
 *
 * `deps.client` 仅用于测试/脚本临时覆盖默认 `bgmClient`，生产路由无需传参。
 */
export function getCovers(
  ids: number[],
  deps?: CoverServiceDeps,
): Promise<Record<string, CoverUrls | null>> {
  return getDefaultService().getCovers(ids, deps);
}

/**
 * 生产入口：单条简介懒加载。tRPC router 调用；永不抛错。
 *
 * `deps.client` 仅用于测试/脚本临时覆盖默认 `bgmClient`，生产路由无需传参。
 */
export function getSummary(
  id: number,
  deps?: CoverServiceDeps,
): Promise<string | null> {
  return getDefaultService().getSummary(id, deps);
}

/** 关闭默认实例的 SQLite 句柄（测试清理 / 进程退出）。 */
export function closeCoverCache(): void {
  if (!defaultService) return;
  defaultService.close();
  defaultService = null;
}
