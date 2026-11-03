import type { PrismaClient } from "@prisma/client";

import {
  COVER_IDS_MAX,
  type CoverUrls,
} from "~/shared/subject-contract";
import { db } from "~/server/db";

import {
  CoverCache,
  DEFAULT_COVER_CACHE_PATH,
  type CoverCacheWrite,
} from "./cover-cache";

/**
 * 封面 URL 解析服务。
 *
 * 产品决策：只解析并缓存「id → {grid,small,common} URL」，图片字节一律不落盘、
 * 不经服务端代理，由浏览器直连 `lain.bgm.tv`。本模块因此只有字符串级缓存，
 * 且**永不向前端抛错**：任何外部/缓存/数据库异常都降级为 `null`（卡片显示占位）。
 */

/** 官方 API 必须带可识别的 User-Agent，否则源站 403。 */
export const COVER_USER_AGENT = "bgm-filter/1.0 (local personal tool)";
export const COVER_API_BASE = "https://api.bgm.tv/v0/subjects";

export const COVER_MAX_CONCURRENCY = 5;
/**
 * 限速取舍：官方默认 3000 次 / 10 分钟 / IP，超限直接封禁 1 小时、响应头又没有任何
 * 限流信息，所以只能自我限速。这里用令牌桶取「平均 4 req/s + 突发 4 个」：
 * - 稳态 4 × 600 = 2400 次/10min，比官方额度留 20% 余量；
 * - 突发容量从 8 降到 4（P2）：冷启动时 4 个并发已够首图，避免瞬时打满 5 并发；
 *   前端每块 10 个 id，突发 4 个后按 250ms 补充，10 个约 1.5s；
 * - 并发仍限制 5，作为硬上限。
 * 50 张全冷启动约 (50-4)/4 ≈ 11.5s（再加最后一次请求耗时）。
 */
export const COVER_REQUESTS_PER_SECOND = 4;
export const COVER_BURST_CAPACITY = 4;
export const COVER_REQUEST_TIMEOUT_MS = 5_000;
/**
 * 熔断：以「连续无任何成功的外部尝试」计数（每次请求/重试各计 1，任何一次成功即清零）。
 * 达到 10 次才打开，打开 30s；过期后进入半开，只放行 1 个探测请求：
 * 成功 → 关闭并恢复正常；失败 → 重新计时 30s。阈值从 5 提到 10、时长 60s→30s，
 * 避免一批瞬时抖动（冷启动突发）被放大成整批 60s 无图。
 */
export const COVER_BREAKER_THRESHOLD = 10;
export const COVER_BREAKER_COOLDOWN_MS = 30_000;
/**
 * 单 id 重试：仅网络错误 / 超时 / 5xx / 429（408 也算），最多重试 1 次；
 * 404 与「200 但 images 为空」都是确定结果，不重试。退避 300–600ms 随机 jitter。
 */
export const COVER_RETRY_MIN_DELAY_MS = 300;
export const COVER_RETRY_MAX_DELAY_MS = 600;
/** 负缓存 TTL：无封面 / NSFW / 404。正缓存永久。 */
export const COVER_NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 外部取数函数：返回官方响应里的 `images` 字段本身；404 抛 `CoverNotFoundError`。 */
export type CoverFetcher = (id: number, signal: AbortSignal) => Promise<unknown>;

/** 可注入时钟，便于单测虚拟时间（TTL / 限速 / 熔断冷却）。 */
export interface CoverClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface CoverServiceOptions {
  /** 默认 `fetch` + UA；测试注入 fake fetcher，绝不联网。 */
  fetcher?: CoverFetcher;
  clock?: CoverClock;
  /** 默认 `.cache/covers.db`；测试用 `:memory:`。 */
  cachePath?: string;
  maxConcurrency?: number;
  /** 令牌桶平均速率（req/s）。 */
  requestsPerSecond?: number;
  /** 令牌桶容量，允许的瞬时突发请求数。 */
  burstCapacity?: number;
  timeoutMs?: number;
  breakerThreshold?: number;
  breakerCooldownMs?: number;
  negativeTtlMs?: number;
  /** 重试退避毫秒数（默认 300–600ms 随机）；测试注入 0 避免等待。 */
  retryDelayMs?: () => number;
  /** 生成单请求超时信号；测试可注入无定时器的实现，避免挂起进程。 */
  createTimeoutSignal?: (timeoutMs: number) => AbortSignal;
  /** 日志出口；默认 `console.warn`，只在失败/熔断时调用。 */
  warn?: (message: string, error?: unknown) => void;
}

export interface CoverService {
  getCovers(
    ids: number[],
    client?: PrismaClient,
  ): Promise<Record<string, CoverUrls | null>>;
  close(): void;
}

export class CoverNotFoundError extends Error {
  constructor(readonly subjectId: number) {
    super(`subject ${subjectId} not found`);
    this.name = "CoverNotFoundError";
  }
}

/** 非 2xx 响应；用于区分可重试的 408/429/5xx 与不可重试的 4xx。 */
export class CoverHttpError extends Error {
  constructor(
    readonly status: number,
    readonly subjectId: number,
  ) {
    super(`Bangumi API ${status} for subject ${subjectId}`);
    this.name = "CoverHttpError";
  }
}

interface NsfwRow {
  id: number | bigint;
  nsfw: boolean | number | bigint;
}

interface FetchOutcome {
  urls: CoverUrls | null;
  /** `true` = 确定结果（有封面 / 无封面 / 404），可写缓存。 */
  cacheable: boolean;
  /** 重试后仍失败（网络/超时/5xx），不写缓存。 */
  failed: boolean;
  /** 首次失败后确实发起过重试。 */
  retried: boolean;
  /** 因熔断已打开/半开而被跳过，未发外部请求。 */
  skipped: boolean;
}

/** 半开状态下由唯一探测请求持有。 */
interface Admission {
  probe: boolean;
}

type AttemptResult =
  | { kind: "success"; images: unknown }
  | { kind: "notFound" }
  | { kind: "error"; error: unknown }
  | { kind: "skipped" };

const realClock: CoverClock = {
  now: () => Date.now(),
  sleep: (ms) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
};

const CIRCUIT_OPEN = Symbol("cover-circuit-open");

/** 仅瞬时错误值得重试；404 与其它 4xx（如 403 UA 被拒）重试也不会变好。 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof CoverNotFoundError) return false;
  if (error instanceof CoverHttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  // fetch TypeError / AbortSignal.timeout 的 TimeoutError / JSON 解析错误等
  return true;
}

/**
 * 纯函数：把官方 `images` 对象转成契约里的三尺寸 URL。
 *
 * 容错空字符串 / null / 非字符串 / 缺字段：任一尺寸缺失时用其它可用尺寸顶替
 * （grid → small → common；common → small → grid），全空返回 null。
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
  };
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

/**
 * 并发闸门 + 令牌桶限速：同时在途 ≤ maxConcurrency；启动速率受令牌桶约束
 * （初始 burstCapacity 个令牌，之后按 requestsPerSecond 补充）。
 */
class RequestGate {
  private active = 0;
  private tokens: number;
  private lastRefillAt: number;
  private pumping = false;
  private readonly waiters: Array<{
    resolve: (release: () => void) => void;
    reject: (error: unknown) => void;
  }> = [];

  constructor(
    private readonly maxConcurrency: number,
    private readonly requestsPerSecond: number,
    private readonly burstCapacity: number,
    private readonly clock: CoverClock,
  ) {
    this.tokens = burstCapacity;
    this.lastRefillAt = clock.now();
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waiters.push({
        resolve: (release) => {
          void Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(release);
        },
        reject,
      });
      void this.pump();
    });
  }

  private refill(): void {
    const now = this.clock.now();
    const elapsedMs = Math.max(0, now - this.lastRefillAt);
    if (elapsedMs <= 0) return;
    this.tokens = Math.min(
      this.burstCapacity,
      this.tokens + (elapsedMs / 1000) * this.requestsPerSecond,
    );
    this.lastRefillAt = now;
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.waiters.length > 0 && this.active < this.maxConcurrency) {
        this.refill();
        if (this.tokens < 1) {
          const waitMs = Math.max(
            1,
            Math.ceil(
              ((1 - this.tokens) / this.requestsPerSecond) * 1000,
            ),
          );
          await this.clock.sleep(waitMs);
          continue;
        }
        const waiter = this.waiters.shift();
        if (!waiter) break;
        this.tokens -= 1;
        this.active += 1;
        waiter.resolve(() => {
          this.active -= 1;
          void this.pump();
        });
      }
    } finally {
      this.pumping = false;
    }
  }
}

class CoverServiceEngine implements CoverService {
  private readonly fetcher: CoverFetcher;
  private readonly clock: CoverClock;
  private readonly cachePath: string;
  private readonly gate: RequestGate;
  private readonly timeoutMs: number;
  private readonly breakerThreshold: number;
  private readonly breakerCooldownMs: number;
  private readonly negativeTtlMs: number;
  private readonly retryDelayMs: () => number;
  private readonly createTimeoutSignal: (timeoutMs: number) => AbortSignal;
  private readonly warn: (message: string, error?: unknown) => void;

  private cache: CoverCache | null = null;
  private cacheFailed = false;
  private consecutiveFailures = 0;
  private breakerState: "closed" | "open" | "half-open" = "closed";
  private circuitOpenUntil = 0;
  private halfOpenProbeInFlight = false;

  constructor(options: CoverServiceOptions) {
    this.fetcher = options.fetcher ?? defaultCoverFetcher;
    this.clock = options.clock ?? realClock;
    this.cachePath = options.cachePath ?? DEFAULT_COVER_CACHE_PATH;
    this.gate = new RequestGate(
      options.maxConcurrency ?? COVER_MAX_CONCURRENCY,
      options.requestsPerSecond ?? COVER_REQUESTS_PER_SECOND,
      options.burstCapacity ?? COVER_BURST_CAPACITY,
      this.clock,
    );
    this.timeoutMs = options.timeoutMs ?? COVER_REQUEST_TIMEOUT_MS;
    this.breakerThreshold =
      options.breakerThreshold ?? COVER_BREAKER_THRESHOLD;
    this.breakerCooldownMs =
      options.breakerCooldownMs ?? COVER_BREAKER_COOLDOWN_MS;
    this.negativeTtlMs = options.negativeTtlMs ?? COVER_NEGATIVE_TTL_MS;
    this.retryDelayMs =
      options.retryDelayMs ??
      (() =>
        COVER_RETRY_MIN_DELAY_MS +
        Math.floor(
          Math.random() *
            (COVER_RETRY_MAX_DELAY_MS - COVER_RETRY_MIN_DELAY_MS + 1),
        ));
    this.createTimeoutSignal =
      options.createTimeoutSignal ?? ((timeoutMs) => AbortSignal.timeout(timeoutMs));
    this.warn =
      options.warn ??
      ((message, error) => {
        if (error === undefined) console.warn(message);
        else console.warn(message, error);
      });
  }

  async getCovers(
    ids: number[],
    client?: PrismaClient,
  ): Promise<Record<string, CoverUrls | null>> {
    const uniqueIds = sanitizeIds(ids);
    if (uniqueIds.length === 0) return {};

    try {
      return await this.resolveCovers(uniqueIds, client);
    } catch (error) {
      // 兜底：缓存/解析/任何意外都不允许把错误抛给前端。
      this.warn("[cover] 封面解析整体失败，本批降级为无封面", error);
      return toRecord(uniqueIds, new Map());
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
    client?: PrismaClient,
  ): Promise<Record<string, CoverUrls | null>> {
    const now = this.clock.now();

    // 0) NSFW 必须先于缓存命中判定。若先读缓存，历史正向缓存（预热 / dump 重导后
    //    nsfw 由 0 变 1）会绕过检查，把 NSFW 封面直接返回给卡片。
    const nsfwFlags = await this.lookupNsfwFlags(ids, client);
    if (nsfwFlags === null) {
      // 失败关闭：查不到 NSFW 标记时连正向缓存也不返回，整批不回源。
      return toRecord(ids, new Map());
    }

    const resolved = new Map<number, CoverUrls | null>();
    const writes: CoverCacheWrite[] = [];
    const pending: number[] = [];
    for (const id of ids) {
      if (nsfwFlags.get(id) === true) {
        resolved.set(id, null);
        // 覆盖可能存在的旧正缓存，避免下次命中旧 URL
        writes.push({ id, urls: null, fetchedAt: now });
      } else {
        pending.push(id);
      }
    }

    // 1) 本地缓存（含负缓存），只处理已确认非 NSFW 的 id
    const cache = this.getCache();
    if (cache) {
      try {
        for (const [id, entry] of cache.getMany(
          pending,
          now,
          this.negativeTtlMs,
        )) {
          resolved.set(id, entry.missing ? null : pickCoverUrls(entry));
        }
      } catch (error) {
        this.warn("[cover] 读取封面缓存失败，继续回源", error);
      }
    }

    const fetchable = pending.filter((id) => !resolved.has(id));
    if (fetchable.length === 0) {
      this.writeCache(writes);
      return toRecord(ids, resolved);
    }

    // 2) 熔断打开（冷却中）或半开探测在飞：未命中的 id 直接 null，不再请求
    if (this.isBreakerBlockingAll(now)) {
      this.writeCache(writes);
      return toRecord(ids, resolved);
    }

    // 3) 只对未命中的非 NSFW 条目回源；单条失败不影响其它 id
    const outcomes = await Promise.all(
      fetchable.map(async (id) => ({ id, outcome: await this.fetchOne(id) })),
    );
    for (const { id, outcome } of outcomes) {
      resolved.set(id, outcome.urls);
      if (outcome.cacheable) {
        writes.push({ id, urls: outcome.urls, fetchedAt: this.clock.now() });
      }
    }

    this.warnFailureSummary(outcomes, fetchable.length);
    this.writeCache(writes);
    return toRecord(ids, resolved);
  }

  /** 单批只打一行汇总，避免逐条刷屏；失败不写缓存，下次仍可重试。 */
  private warnFailureSummary(
    outcomes: ReadonlyArray<{ id: number; outcome: FetchOutcome }>,
    total: number,
  ): void {
    const failed = outcomes.filter((item) => item.outcome.failed).length;
    const retried = outcomes.filter((item) => item.outcome.retried).length;
    const skipped = outcomes.filter((item) => item.outcome.skipped).length;
    if (failed === 0 && skipped === 0) return;
    this.warn(
      `[cover] 本批 ${failed}/${total} 条失败（已重试 ${retried} 条，未写缓存、下次可重试），` +
        `${skipped} 条因熔断跳过；连续无成功 ${this.consecutiveFailures}/${this.breakerThreshold}`,
    );
  }

  /** 取单条封面：瞬时错误重试 1 次；错误全部吞掉，只回报结果与是否可缓存。 */
  private async fetchOne(id: number): Promise<FetchOutcome> {
    const admission = this.admit(this.clock.now());
    if (!admission) {
      return this.outcome(null, false, false, false, true);
    }

    const first = await this.attempt(id, admission.probe);
    if (first.kind === "success") {
      this.recordSuccess(admission);
      return this.outcome(pickCoverUrls(first.images), true, false, false, false);
    }
    if (first.kind === "notFound") {
      // 404 是确定结果：不重试、写负缓存；算一次正常完成并清零连续失败
      this.recordSuccess(admission);
      return this.outcome(null, true, false, false, false);
    }
    if (first.kind === "skipped") {
      return this.outcome(null, false, false, false, true);
    }

    // 第一次外部尝试失败：按「连续无任何成功」计数（半开探测失败会立即重开）
    this.recordFailure(admission, this.clock.now());
    if (this.breakerState !== "closed" || admission.probe) {
      return this.outcome(null, false, true, false, false);
    }
    if (!isRetryableError(first.error)) {
      return this.outcome(null, false, true, false, false);
    }

    // 退避时不占并发槽；退避期间若熔断已打开则不再补发，避免继续压外部接口
    await this.clock.sleep(this.retryDelayMs());
    if (this.breakerState !== "closed") {
      return this.outcome(null, false, true, false, false);
    }

    const second = await this.attempt(id, false);
    if (second.kind === "success") {
      this.recordSuccess(admission);
      return this.outcome(pickCoverUrls(second.images), true, false, true, false);
    }
    if (second.kind === "notFound") {
      this.recordSuccess(admission);
      return this.outcome(null, true, false, true, false);
    }
    if (second.kind === "skipped") {
      return this.outcome(null, false, true, false, false);
    }

    this.recordFailure(admission, this.clock.now());
    return this.outcome(null, false, true, true, false);
  }

  private outcome(
    urls: CoverUrls | null,
    cacheable: boolean,
    failed: boolean,
    retried: boolean,
    skipped: boolean,
  ): FetchOutcome {
    return { urls, cacheable, failed, retried, skipped };
  }

  /** 单次外部请求；被熔断拦下时返回 skipped（不发请求、不计失败）。 */
  private async attempt(id: number, probe: boolean): Promise<AttemptResult> {
    try {
      const result = await this.gate.run(async () => {
        // 普通请求排队期间熔断可能已打开：发车前再检查一次
        if (!probe && this.breakerState !== "closed") return CIRCUIT_OPEN;
        return await this.fetcher(id, this.createTimeoutSignal(this.timeoutMs));
      });
      if (result === CIRCUIT_OPEN) return { kind: "skipped" };
      return { kind: "success", images: result };
    } catch (error) {
      if (error instanceof CoverNotFoundError) return { kind: "notFound" };
      return { kind: "error", error };
    }
  }

  private async lookupNsfwFlags(
    ids: readonly number[],
    client?: PrismaClient,
  ): Promise<Map<number, boolean> | null> {
    if (ids.length === 0) return new Map();
    const placeholders = ids.map(() => "?").join(", ");
    const prisma = client ?? db;
    try {
      const rows = await prisma.$queryRawUnsafe<NsfwRow[]>(
        `SELECT id, nsfw FROM "Subject" WHERE id IN (${placeholders})`,
        ...ids,
      );
      const flags = new Map<number, boolean>();
      for (const row of rows) {
        flags.set(Number(row.id), Boolean(Number(row.nsfw)));
      }
      return flags;
    } catch (error) {
      // 查不到 NSFW 标记时宁可整批不取（含正向缓存），也不误取 NSFW 封面。
      this.warn("[cover] 查询 Subject.nsfw 失败，本批不取封面", error);
      return null;
    }
  }

  /** 半开/打开准入：closed 放行；open 过期后只放行 1 个探测；其余拒绝。 */
  private admit(now: number): Admission | null {
    if (this.breakerState === "closed") return { probe: false };
    if (this.breakerState === "open") {
      if (now < this.circuitOpenUntil) return null;
      this.breakerState = "half-open";
      this.halfOpenProbeInFlight = false;
    }
    if (this.halfOpenProbeInFlight) return null;
    this.halfOpenProbeInFlight = true;
    return { probe: true };
  }

  /** 熔断打开且冷却未结束，或半开探测在飞：新批次只读缓存、不回源。 */
  private isBreakerBlockingAll(now: number): boolean {
    if (this.breakerState === "half-open") return true;
    return this.breakerState === "open" && now < this.circuitOpenUntil;
  }

  /**
   * 任何一次成功（有封面 / 无封面 / 404）都说明外部接口可用，清零连续失败。
   * 半开探测成功则关闭熔断；普通请求的成功不会提前取消已经打开的冷却。
   */
  private recordSuccess(admission: Admission): void {
    this.consecutiveFailures = 0;
    if (admission.probe) {
      this.breakerState = "closed";
      this.circuitOpenUntil = 0;
      this.halfOpenProbeInFlight = false;
      this.warn("[cover] 熔断半开探测成功，恢复外部请求");
    }
  }

  /**
   * 只在「closed」状态累计连续失败，任何成功都会清零；因此单个 id 的偶发失败
   * 不会单独触发熔断，只有连续 10 次完全没有成功才打开。半开探测失败则立即重开。
   */
  private recordFailure(admission: Admission, now: number): void {
    if (this.breakerState !== "closed" && !admission.probe) return;
    this.consecutiveFailures += 1;
    if (admission.probe) {
      this.openBreaker(now, "半开探测失败");
      return;
    }
    if (
      this.breakerState === "closed" &&
      this.consecutiveFailures >= this.breakerThreshold
    ) {
      this.openBreaker(
        now,
        `连续 ${this.breakerThreshold} 次外部请求失败/超时`,
      );
    }
  }

  private openBreaker(now: number, reason: string): void {
    this.breakerState = "open";
    this.circuitOpenUntil = now + this.breakerCooldownMs;
    this.halfOpenProbeInFlight = false;
    this.consecutiveFailures = 0;
    this.warn(
      `[cover] ${reason}，暂停外部请求 ${Math.round(
        this.breakerCooldownMs / 1000,
      )}s，之后放行 1 个半开探测`,
    );
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

/** 默认 fetcher：带 UA、5s 超时，从 `/v0/subjects/{id}` 取 `images`。 */
async function defaultCoverFetcher(
  id: number,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(`${COVER_API_BASE}/${id}`, {
    headers: {
      "User-Agent": COVER_USER_AGENT,
      Accept: "application/json",
    },
    signal,
    cache: "no-store",
  });

  if (response.status === 404) throw new CoverNotFoundError(id);
  if (!response.ok) throw new CoverHttpError(response.status, id);

  const body: unknown = await response.json();
  if (body !== null && typeof body === "object" && "images" in body) {
    return (body as { images: unknown }).images;
  }
  return undefined;
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

/** 创建独立实例（测试注入 fake fetcher / clock / 内存缓存）。 */
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
 */
export function getCovers(
  ids: number[],
  client?: PrismaClient,
): Promise<Record<string, CoverUrls | null>> {
  return getDefaultService().getCovers(ids, client);
}

/** 关闭默认实例的 SQLite 句柄（测试清理 / 进程退出）。 */
export function closeCoverCache(): void {
  if (!defaultService) return;
  defaultService.close();
  defaultService = null;
}
