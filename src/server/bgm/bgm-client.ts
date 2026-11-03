/**
 * Bangumi 官方 API 客户端：**所有** bgm 外部请求的唯一出口。
 *
 * 集中管理：base URL、User-Agent、可选 Bearer token、超时、令牌桶限速、
 * 并发闸门、瞬时错误重试、熔断、HTTP 错误映射。新增搜索 / 条目 / 人物等
 * 接口时只需在 `BgmClient` 上追加方法并复用 `request()`，不要再自行读
 * `process.env.BGM_API_TOKEN`、拼 header 或各自限速。
 *
 * 安全：token 只存在于私有字段与请求头中，绝不写入日志、缓存或异常信息。
 */

/** 默认官方 API 根地址（接口路径形如 `/v0/subjects/1`）。 */
export const BGM_API_BASE_URL = "https://api.bgm.tv";
/** 官方 API 必须带可识别的 User-Agent，否则源站 403。 */
export const BGM_USER_AGENT = "bgm-filter/1.0 (local personal tool)";

export const BGM_MAX_CONCURRENCY = 5;
/**
 * 限速取舍：官方默认 3000 次 / 10 分钟 / IP，超限直接封禁 1 小时、响应头又没有任何
 * 限流信息，所以只能自我限速。令牌桶取「平均 4 req/s + 突发 4 个」：
 * - 稳态 4 × 600 = 2400 次/10min，比官方额度留 20% 余量；
 * - 突发容量 4：冷启动时 4 个并发已够首图，避免瞬时打满 5 并发；
 * - 并发仍限制 5，作为硬上限。
 */
export const BGM_REQUESTS_PER_SECOND = 4;
export const BGM_BURST_CAPACITY = 4;
export const BGM_REQUEST_TIMEOUT_MS = 5_000;
/**
 * 熔断：以「连续无任何成功的外部尝试」计数（每次请求/重试各计 1，任何一次
 * 成功即清零）。达到 10 次才打开，打开 30s；过期后进入半开，只放行 1 个探测
 * 请求：成功 → 关闭并恢复；失败 → 重新计时 30s。
 */
export const BGM_BREAKER_THRESHOLD = 10;
export const BGM_BREAKER_COOLDOWN_MS = 30_000;
/**
 * 重试：仅网络错误 / 超时 / 5xx / 429 / 408，最多重试 1 次；404 与其它确定性
 * 4xx 不重试。退避 300–600ms 随机 jitter。
 */
export const BGM_RETRY_MIN_DELAY_MS = 300;
export const BGM_RETRY_MAX_DELAY_MS = 600;

/** 可注入时钟，便于单测虚拟时间（限速 / 熔断冷却 / 重试退避）。 */
export interface BgmClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

/** 可注入 fetch（测试用，避免联网）。 */
export type BgmFetch = (url: string, init: RequestInit) => Promise<Response>;

/** 官方 `images` 字段中实际用到的尺寸；其余字段忽略。 */
export interface BgmSubjectImages {
  large?: string | null;
  common?: string | null;
  medium?: string | null;
  small?: string | null;
  grid?: string | null;
}

/** 只声明用到的字段，避免过度建模官方响应。 */
export interface BgmSubject {
  id: number;
  name: string;
  name_cn?: string | null;
  images?: BgmSubjectImages | null;
}

export interface BgmClientOptions {
  /** 默认 `https://api.bgm.tv`。 */
  baseUrl?: string;
  /** 默认 `bgm-filter/1.0 (local personal tool)`。 */
  userAgent?: string;
  /**
   * 默认读 `process.env.BGM_API_TOKEN`；构造时显式传值可覆盖。
   * 传 `null` / 空串表示匿名请求（不带 Authorization）。
   */
  token?: string | null;
  timeoutMs?: number;
  maxConcurrency?: number;
  /** 令牌桶平均速率（req/s）。 */
  requestsPerSecond?: number;
  /** 令牌桶容量，允许的瞬时突发请求数。 */
  burstCapacity?: number;
  breakerThreshold?: number;
  breakerCooldownMs?: number;
  /** 重试退避毫秒数（默认 300–600ms 随机）；测试注入 0 避免等待。 */
  retryDelayMs?: () => number;
  /** 网络出口；默认全局 `fetch`。 */
  fetch?: BgmFetch;
  clock?: BgmClock;
  /** 生成单请求超时信号；测试可注入无定时器的实现，避免挂起进程。 */
  createTimeoutSignal?: (timeoutMs: number) => AbortSignal;
  /** 日志出口；默认 `console.warn`，只在熔断状态变化时调用。 */
  warn?: (message: string, error?: unknown) => void;
}

/** 非 2xx 响应。404 是确定性结果，调用方据此映射 `not_found`。 */
export class BgmHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`Bangumi API ${status}（${path}）`);
    this.name = "BgmHttpError";
  }
}

/** 网络错误 / 超时 / JSON 解析失败；不保留原始异常，避免把请求头带进日志。 */
export class BgmNetworkError extends Error {
  constructor(readonly path: string) {
    super(`Bangumi API 网络错误或超时（${path}）`);
    this.name = "BgmNetworkError";
  }
}

/** 熔断打开（或半开探测在飞）时短路返回，未发出外部请求。 */
export class BgmCircuitOpenError extends Error {
  constructor(readonly path: string) {
    super(`Bangumi API 熔断打开，本请求已跳过（${path}）`);
    this.name = "BgmCircuitOpenError";
  }
}

/** 半开状态下由唯一探测请求持有。 */
interface Admission {
  probe: boolean;
}

type AttemptResult<T> =
  | { kind: "success"; data: T }
  | { kind: "http"; error: BgmHttpError }
  | { kind: "transient"; error: BgmNetworkError | BgmHttpError }
  | { kind: "skipped" };

const realClock: BgmClock = {
  now: () => Date.now(),
  sleep: (ms) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
};

const CIRCUIT_OPEN = Symbol("bgm-circuit-open");

/** 仅瞬时错误值得重试；404 与其它 4xx（如 403 UA 被拒）重试也不会变好。 */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function defaultRetryDelayMs(): number {
  return (
    BGM_RETRY_MIN_DELAY_MS +
    Math.floor(
      Math.random() * (BGM_RETRY_MAX_DELAY_MS - BGM_RETRY_MIN_DELAY_MS + 1),
    )
  );
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
    private readonly clock: BgmClock,
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
            Math.ceil(((1 - this.tokens) / this.requestsPerSecond) * 1000),
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

/**
 * Bangumi API 客户端。默认单例见文件末尾的 `bgmClient`；测试 / 脚本可
 * `new BgmClient({ token, fetch, clock, ... })` 注入，不依赖模块级状态。
 */
export class BgmClient {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly token: string | null;
  private readonly gate: RequestGate;
  private readonly timeoutMs: number;
  private readonly breakerThreshold: number;
  private readonly breakerCooldownMs: number;
  private readonly retryDelayMs: () => number;
  private readonly fetchImpl: BgmFetch;
  private readonly clock: BgmClock;
  private readonly createTimeoutSignal: (timeoutMs: number) => AbortSignal;
  private readonly warn: (message: string, error?: unknown) => void;

  private consecutiveFailures = 0;
  private breakerState: "closed" | "open" | "half-open" = "closed";
  private circuitOpenUntil = 0;
  private halfOpenProbeInFlight = false;

  constructor(options: BgmClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? BGM_API_BASE_URL).replace(/\/+$/, "");
    this.userAgent = options.userAgent ?? BGM_USER_AGENT;
    const token =
      options.token === undefined
        ? process.env.BGM_API_TOKEN
        : options.token;
    // 只保留非空 token；空串 / 纯空白按匿名处理。
    this.token = token?.trim() || null;

    this.clock = options.clock ?? realClock;
    this.gate = new RequestGate(
      options.maxConcurrency ?? BGM_MAX_CONCURRENCY,
      options.requestsPerSecond ?? BGM_REQUESTS_PER_SECOND,
      options.burstCapacity ?? BGM_BURST_CAPACITY,
      this.clock,
    );
    this.timeoutMs = options.timeoutMs ?? BGM_REQUEST_TIMEOUT_MS;
    this.breakerThreshold =
      options.breakerThreshold ?? BGM_BREAKER_THRESHOLD;
    this.breakerCooldownMs =
      options.breakerCooldownMs ?? BGM_BREAKER_COOLDOWN_MS;
    this.retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
    this.fetchImpl =
      options.fetch ?? ((url, init) => fetch(url, init));
    this.createTimeoutSignal =
      options.createTimeoutSignal ??
      ((timeoutMs) => AbortSignal.timeout(timeoutMs));
    this.warn =
      options.warn ??
      ((message, error) => {
        if (error === undefined) console.warn(message);
        else console.warn(message, error);
      });
  }

  /**
   * 统一请求入口：拼 base URL、加 UA / Accept / 可选 Bearer，执行限速、
   * 并发控制、瞬时错误重试与熔断。
   *
   * - 2xx → 解析 JSON 返回 `T`；
   * - 非 2xx → 抛 `BgmHttpError(status)`（404 由 `getSubject` 映射为 null）；
   * - 网络/超时/解析失败 → 抛 `BgmNetworkError`；
   * - 熔断短路 → 抛 `BgmCircuitOpenError`。
   *
   * 只接受相对路径，避免 token 被发往调用方给出的其它主机。
   */
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = this.buildUrl(path);
    const errorPath = this.redact(path);
    const admission = this.admit(this.clock.now());
    if (!admission) throw new BgmCircuitOpenError(errorPath);

    const first = await this.attempt<T>(url, init, errorPath, admission.probe);
    if (first.kind === "success") {
      this.recordSuccess(admission);
      return first.data;
    }
    if (first.kind === "http") {
      // 4xx（含 404/403）说明源站可达：关闭半开探测、清零连续失败，但把
      // 确定性错误抛给调用方自行映射。
      this.recordSuccess(admission);
      throw first.error;
    }
    if (first.kind === "skipped") {
      throw new BgmCircuitOpenError(errorPath);
    }

    // 第一次外部尝试失败：按「连续无任何成功」计数（半开探测失败立即重开）。
    this.recordFailure(admission, this.clock.now());
    if (admission.probe || this.breakerState !== "closed") {
      throw first.error;
    }

    // 退避时不占并发槽；退避期间熔断打开则不再补发，避免继续压外部接口。
    await this.clock.sleep(this.retryDelayMs());
    if (this.breakerState !== "closed") throw first.error;

    const second = await this.attempt<T>(url, init, errorPath, false);
    if (second.kind === "success") {
      this.recordSuccess(admission);
      return second.data;
    }
    if (second.kind === "http") {
      this.recordSuccess(admission);
      throw second.error;
    }
    if (second.kind === "skipped") {
      throw new BgmCircuitOpenError(errorPath);
    }

    this.recordFailure(admission, this.clock.now());
    throw second.error;
  }

  /** 取单个条目；404 → null（其余错误照常抛出，由调用方分类）。 */
  async getSubject(id: number): Promise<BgmSubject | null> {
    try {
      return await this.request<BgmSubject>(`/v0/subjects/${id}`);
    } catch (error) {
      if (error instanceof BgmHttpError && error.status === 404) return null;
      throw error;
    }
  }

  /** 只允许相对路径；绝对 URL 会绕过 baseUrl（并可能把 token 发往他处）。 */
  private buildUrl(path: string): string {
    if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith("//")) {
      throw new TypeError("BgmClient.request 只接受相对路径");
    }
    const suffix = path.startsWith("/") ? path : `/${path}`;
    return `${this.baseUrl}${suffix}`;
  }

  /** 日志/异常中的路径脱敏：万一调用方把 token 拼进 path，也不外泄。 */
  private redact(text: string): string {
    if (!this.token) return text;
    return text.split(this.token).join("[redacted]");
  }

  private buildHeaders(input?: HeadersInit): Headers {
    const headers = new Headers(input);
    headers.set("Accept", "application/json");
    headers.set("User-Agent", this.userAgent);
    if (this.token) {
      headers.set("Authorization", `Bearer ${this.token}`);
    } else {
      // 匿名模式不允许调用方自带 Authorization，避免绕过统一鉴权。
      headers.delete("Authorization");
    }
    return headers;
  }

  private createSignal(external?: AbortSignal | null): AbortSignal {
    const timeout = this.createTimeoutSignal(this.timeoutMs);
    return external ? AbortSignal.any([external, timeout]) : timeout;
  }

  /** 单次外部请求；被熔断拦下时返回 skipped（不发请求、不计失败）。 */
  private async attempt<T>(
    url: string,
    init: RequestInit,
    errorPath: string,
    probe: boolean,
  ): Promise<AttemptResult<T>> {
    try {
      const result = await this.gate.run<Response | typeof CIRCUIT_OPEN>(
        async () => {
          // 普通请求排队期间熔断可能已打开：发车前再检查一次。
          if (!probe && this.breakerState !== "closed") return CIRCUIT_OPEN;
          return await this.fetchImpl(url, {
            ...init,
            headers: this.buildHeaders(init.headers),
            signal: this.createSignal(init.signal),
            cache: init.cache ?? "no-store",
          });
        },
      );

      if (result === CIRCUIT_OPEN) return { kind: "skipped" };
      if (result.status === 404) {
        return { kind: "http", error: new BgmHttpError(404, errorPath) };
      }
      if (!result.ok) {
        const error = new BgmHttpError(result.status, errorPath);
        return isRetryableStatus(result.status)
          ? { kind: "transient", error }
          : { kind: "http", error };
      }

      try {
        const data = (await result.json()) as T;
        return { kind: "success", data };
      } catch {
        // JSON 解析失败通常是上游截断 / 代理错误，按瞬时错误处理。
        return { kind: "transient", error: new BgmNetworkError(errorPath) };
      }
    } catch {
      // 不保留原始异常：其 message / cause 可能带请求细节，统一换成脱敏错误。
      return { kind: "transient", error: new BgmNetworkError(errorPath) };
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

  /**
   * 任何一次成功（2xx 或确定性 4xx）都说明外部接口可用，清零连续失败。
   * 半开探测成功则关闭熔断；普通请求的成功不会提前取消已经打开的冷却。
   */
  private recordSuccess(admission: Admission): void {
    this.consecutiveFailures = 0;
    if (admission.probe) {
      this.breakerState = "closed";
      this.circuitOpenUntil = 0;
      this.halfOpenProbeInFlight = false;
      this.warn("[bgm] 熔断半开探测成功，恢复外部请求");
    }
  }

  /**
   * 只在「closed」状态累计连续失败，任何成功都会清零；因此单个条目的偶发失败
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
      `[bgm] ${reason}，暂停外部请求 ${Math.round(
        this.breakerCooldownMs / 1000,
      )}s，之后放行 1 个半开探测`,
    );
  }
}

/**
 * 生产单例。测试 / 脚本请 `new BgmClient(...)` 或向 `getCovers` 注入，
 * 不要依赖此单例的内部状态。
 */
export const bgmClient = new BgmClient();
