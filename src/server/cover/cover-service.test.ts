/**
 * `cover-service` 单测：全部使用 fake fetcher + 假时钟 + `:memory:` 缓存，
 * 不联网、不碰真实 `.cache/covers.db` / `prisma/dev.db`。
 */

import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COVER_IDS_MAX,
  type CoverUrls,
} from "~/shared/subject-contract";

import {
  COVER_BREAKER_COOLDOWN_MS,
  COVER_BREAKER_THRESHOLD,
  COVER_BURST_CAPACITY,
  COVER_MAX_CONCURRENCY,
  COVER_NEGATIVE_TTL_MS,
  COVER_NOT_FOUND_TTL_MS,
  COVER_REQUESTS_PER_SECOND,
  CoverHttpError,
  CoverNotFoundError,
  createCoverService,
  fetchCoverFromBangumi,
  pickCoverUrls,
  type CoverClock,
  type CoverFetcher,
  type CoverService,
  type CoverServiceOptions,
} from "./cover-service";

interface FakeClock extends CoverClock {
  advance(ms: number): void;
}

/**
 * 虚拟时间：sleep 先让出一个真实宏任务（让在途 fetcher 的失败/完成回调先跑完），
 * 再把时间往前拨 —— 既不用真等限速间隔，也不会让「失败记录」晚于下一次发车。
 */
function createFakeClock(start = 1_700_000_000_000): FakeClock {
  let current = start;
  return {
    now: () => current,
    sleep: async (ms) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      current += ms;
    },
    advance: (ms) => {
      current += ms;
    },
  };
}

function coverUrls(id: number): CoverUrls {
  return {
    grid: `https://lain.bgm.tv/r/100/pic/cover/l/aa/bb/${id}_grid.jpg`,
    small: `https://lain.bgm.tv/r/200/pic/cover/l/aa/bb/${id}_small.jpg`,
    common: `https://lain.bgm.tv/r/400/pic/cover/l/aa/bb/${id}_common.jpg`,
  };
}

/** 记录调用次数/顺序的 fake fetcher。 */
function createFetcher(
  handler: (id: number) => unknown | Promise<unknown>,
): { fetcher: CoverFetcher; calls: number[] } {
  const calls: number[] = [];
  const fetcher: CoverFetcher = async (id) => {
    calls.push(id);
    return await handler(id);
  };
  return { fetcher, calls };
}

/** 兼容 getCovers 签名用的假 Prisma；服务已不再查询 Subject.nsfw。 */
function createFakePrisma(nsfwIds: readonly number[] = []): PrismaClient {
  const nsfw = new Set(nsfwIds);
  return {
    $queryRawUnsafe: async (_sql: string, ...ids: unknown[]) =>
      ids.map((id) => ({
        id: Number(id),
        nsfw: nsfw.has(Number(id)) ? 1 : 0,
      })),
  } as unknown as PrismaClient;
}

const services: CoverService[] = [];

function createTestService(options: CoverServiceOptions = {}): {
  service: CoverService;
  clock: FakeClock;
} {
  const clock = (options.clock as FakeClock | undefined) ?? createFakeClock();
  const service = createCoverService({
    cachePath: ":memory:",
    // 单测不真的等 300–600ms 退避；需要断言退避时可显式覆盖
    retryDelayMs: () => 0,
    createTimeoutSignal: () => new AbortController().signal,
    warn: () => {},
    ...options,
    clock,
  });
  services.push(service);
  return { service, clock };
}

afterEach(() => {
  for (const service of services.splice(0)) service.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("pickCoverUrls", () => {
  it("正常返回三个尺寸", () => {
    const images = { ...coverUrls(1), large: "https://lain.bgm.tv/large.jpg" };
    expect(pickCoverUrls(images)).toEqual(coverUrls(1));
  });

  it("空字符串 / 全空视为无封面", () => {
    expect(
      pickCoverUrls({ grid: "", small: "", common: "", large: "x" }),
    ).toBeNull();
    expect(pickCoverUrls({})).toBeNull();
  });

  it("null / 非对象 / 数组均返回 null", () => {
    for (const value of [null, undefined, "x", 42, [], true]) {
      expect(pickCoverUrls(value)).toBeNull();
    }
  });

  it("缺 common 时用 small 顶替", () => {
    expect(pickCoverUrls({ grid: "g", small: "s" })).toEqual({
      grid: "g",
      small: "s",
      common: "s",
    });
  });

  it("缺 small 时用 common 顶替", () => {
    expect(pickCoverUrls({ grid: "g", common: "c" })).toEqual({
      grid: "g",
      small: "c",
      common: "c",
    });
  });

  it("只有 grid 时三个尺寸都用 grid", () => {
    expect(pickCoverUrls({ grid: "g" })).toEqual({
      grid: "g",
      small: "g",
      common: "g",
    });
  });

  it("null / 空白 / 非字符串字段均视为缺失", () => {
    expect(
      pickCoverUrls({ grid: "  ", small: null, common: "c" }),
    ).toEqual({ grid: "c", small: "c", common: "c" });
  });
});

describe("cover-service 缓存", () => {
  it("正缓存：写入后不再请求，且结果稳定", async () => {
    const { fetcher, calls } = createFetcher((id) => coverUrls(id));
    const { service } = createTestService({ fetcher });
    const db = createFakePrisma();

    const first = await service.getCovers([1], db);
    const second = await service.getCovers([1], db);

    expect(calls).toEqual([1]);
    expect(first).toEqual({ "1": coverUrls(1) });
    expect(second).toEqual(first);
  });

  it("正缓存永久有效（不受负缓存 TTL 影响）", async () => {
    const { fetcher, calls } = createFetcher((id) => coverUrls(id));
    const { service, clock } = createTestService({ fetcher });

    await service.getCovers([1], createFakePrisma());
    clock.advance(365 * 24 * 60 * 60 * 1000);
    await service.getCovers([1], createFakePrisma());

    expect(calls).toEqual([1]);
  });

  it("负缓存：确认无封面后不再请求", async () => {
    const { fetcher, calls } = createFetcher(() => ({
      grid: "",
      small: "",
      common: "",
    }));
    const { service } = createTestService({ fetcher });

    expect(await service.getCovers([7], createFakePrisma())).toEqual({
      "7": null,
    });
    expect(await service.getCovers([7], createFakePrisma())).toEqual({
      "7": null,
    });
    expect(calls).toEqual([7]);
  });

  it("负缓存 TTL 7 天：过期后重新请求", async () => {
    const { fetcher, calls } = createFetcher(() => ({ grid: "", small: "", common: "" }));
    const { service, clock } = createTestService({ fetcher });

    await service.getCovers([7], createFakePrisma());
    expect(calls).toHaveLength(1);

    clock.advance(COVER_NEGATIVE_TTL_MS - 1_000);
    await service.getCovers([7], createFakePrisma());
    expect(calls).toHaveLength(1);

    clock.advance(2_000);
    await service.getCovers([7], createFakePrisma());
    expect(calls).toHaveLength(2);
  });

  it("404 也写负缓存，不重复请求", async () => {
    const { fetcher, calls } = createFetcher(() => {
      throw new CoverNotFoundError(9);
    });
    const { service } = createTestService({ fetcher });

    expect(await service.getCovers([9], createFakePrisma())).toEqual({
      "9": null,
    });
    expect(await service.getCovers([9], createFakePrisma())).toEqual({
      "9": null,
    });
    expect(calls).toEqual([9]);
  });

  it("404 负缓存 TTL 1 天：过期后重新请求", async () => {
    const { fetcher, calls } = createFetcher(() => {
      throw new CoverNotFoundError(19);
    });
    const { service, clock } = createTestService({ fetcher });

    await service.getCovers([19], createFakePrisma());
    expect(calls).toHaveLength(1);

    clock.advance(COVER_NOT_FOUND_TTL_MS - 1_000);
    await service.getCovers([19], createFakePrisma());
    expect(calls).toHaveLength(1);

    clock.advance(2_000);
    await service.getCovers([19], createFakePrisma());
    expect(calls).toHaveLength(2);
  });

  it("无图负缓存不会被 404 的 1 天 TTL 提前清掉", async () => {
    const { fetcher, calls } = createFetcher(() => ({
      grid: "",
      small: "",
      common: "",
    }));
    const { service, clock } = createTestService({ fetcher });

    await service.getCovers([29], createFakePrisma());
    expect(calls).toHaveLength(1);

    // 超过 404 的 1 天 TTL，但仍远小于无图的 7 天 TTL
    clock.advance(COVER_NOT_FOUND_TTL_MS + 60 * 60 * 1000);
    await service.getCovers([29], createFakePrisma());
    expect(calls).toHaveLength(1);
  });

  it("临时网络失败不写负缓存，下次会重试", async () => {
    let broken = true;
    const { fetcher, calls } = createFetcher((id) => {
      if (broken) throw new Error("ECONNRESET");
      return coverUrls(id);
    });
    const { service } = createTestService({ fetcher });

    expect(await service.getCovers([3], createFakePrisma())).toEqual({
      "3": null,
    });
    broken = false;
    expect(await service.getCovers([3], createFakePrisma())).toEqual({
      "3": coverUrls(3),
    });
    // 第一次：首次失败 + 重试失败；第二次：一次成功
    expect(calls).toEqual([3, 3, 3]);
  });

  it("单条失败不影响同批其它 id", async () => {
    const { fetcher } = createFetcher((id) => {
      if (id === 2) throw new Error("boom");
      return coverUrls(id);
    });
    const { service } = createTestService({ fetcher });

    expect(await service.getCovers([1, 2, 3], createFakePrisma())).toEqual({
      "1": coverUrls(1),
      "2": null,
      "3": coverUrls(3),
    });
  });
});

describe("cover-service NSFW 策略（已取消限制）", () => {
  it("NSFW id 与普通 id 一样回源并返回 URL，且不再查询 Subject.nsfw", async () => {
    const { fetcher, calls } = createFetcher((id) => coverUrls(id));
    const { service } = createTestService({ fetcher });
    let queried = false;
    const client = {
      $queryRawUnsafe: async () => {
        queried = true;
        throw new Error("should not query Subject.nsfw");
      },
    } as unknown as PrismaClient;

    const result = await service.getCovers([22290, 226254], client);

    expect(queried).toBe(false);
    expect([...calls].sort((a, b) => a - b)).toEqual([22290, 226254]);
    expect(result["22290"]).toEqual(coverUrls(22290));
    expect(result["226254"]).toEqual(coverUrls(226254));
  });
});

describe("cover-service token", () => {
  function mockFetch(): ReturnType<typeof vi.fn> {
    return vi.fn(
      async () =>
        new Response(JSON.stringify({ images: coverUrls(1) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
  }

  it("BGM_API_TOKEN 存在时请求头带 Authorization: Bearer", async () => {
    vi.stubEnv("BGM_API_TOKEN", "secret-token");
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);

    const images = await fetchCoverFromBangumi(
      1,
      new AbortController().signal,
    );
    expect(images).toEqual(coverUrls(1));

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-token");
    expect(headers["User-Agent"]).toContain("bgm-filter");
  });

  it("BGM_API_TOKEN 未配置时不带 Authorization", async () => {
    vi.stubEnv("BGM_API_TOKEN", "");
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);

    await fetchCoverFromBangumi(1, new AbortController().signal);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers).not.toHaveProperty("Authorization");
    expect(headers["User-Agent"]).toContain("bgm-filter");
  });
});

describe("cover-service 限速与并发", () => {
  it("令牌桶：并发 ≤5，前 4 个可突发，之后平均 4 req/s", async () => {
    expect(COVER_REQUESTS_PER_SECOND).toBe(4);
    expect(COVER_BURST_CAPACITY).toBe(4);

    const clock = createFakeClock();
    const ids = Array.from({ length: 14 }, (_, index) => 100 + index);
    const starts: number[] = [];
    let active = 0;
    let maxActive = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const fetcher: CoverFetcher = async (id) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      starts.push(clock.now());
      await gate;
      active -= 1;
      return coverUrls(id);
    };
    const { service } = createTestService({ fetcher, clock });

    const promise = service.getCovers(ids, createFakePrisma());
    // 等第一批发车（假时钟只影响闸门，这里用真实宏任务让微任务队列跑完）
    await new Promise((resolve) => setTimeout(resolve, 20));

    // 突发 4 个立即发车；250ms 后补充第 5 个令牌，凑满并发上限 5
    expect(starts).toHaveLength(COVER_MAX_CONCURRENCY);
    expect(maxActive).toBe(COVER_MAX_CONCURRENCY);

    release();
    const result = await promise;

    expect(Object.keys(result)).toHaveLength(ids.length);
    expect(maxActive).toBeLessThanOrEqual(COVER_MAX_CONCURRENCY);

    const sorted = [...starts].sort((a, b) => a - b);
    // 前 4 个走突发令牌，虚拟时间相同
    expect(new Set(sorted.slice(0, COVER_BURST_CAPACITY)).size).toBe(1);
    // 令牌耗尽后按 4 req/s（250ms/个）补充
    for (let index = COVER_BURST_CAPACITY; index < sorted.length; index += 1) {
      expect(sorted[index]! - sorted[index - 1]!).toBeGreaterThanOrEqual(
        1000 / COVER_REQUESTS_PER_SECOND,
      );
    }
  });
});

describe("cover-service 重试", () => {
  it("网络错误重试 1 次成功后返回 URL", async () => {
    let attempts = 0;
    const { fetcher, calls } = createFetcher((id) => {
      attempts += 1;
      if (attempts === 1) throw new Error("ECONNRESET");
      return coverUrls(id);
    });
    const { service } = createTestService({ fetcher });

    const result = await service.getCovers([11], createFakePrisma());
    expect(calls).toEqual([11, 11]);
    expect(result["11"]).toEqual(coverUrls(11));
  });

  it("5xx 可重试；重试成功会清零连续失败（threshold=2 仍可继续请求）", async () => {
    const attemptsById = new Map<number, number>();
    const { fetcher, calls } = createFetcher((id) => {
      const count = (attemptsById.get(id) ?? 0) + 1;
      attemptsById.set(id, count);
      if (count === 1) throw new CoverHttpError(503, id);
      return coverUrls(id);
    });
    const { service } = createTestService({ fetcher, breakerThreshold: 2 });

    // 若首次失败没有在重试成功后清零，第二个 id 的首次失败会凑满 2 次并熔断
    const first = await service.getCovers([21], createFakePrisma());
    expect(first["21"]).toEqual(coverUrls(21));
    const second = await service.getCovers([22], createFakePrisma());
    expect(second["22"]).toEqual(coverUrls(22));
    expect([...calls].sort((a, b) => a - b)).toEqual([21, 21, 22, 22]);
  });

  it("重试耗尽返回 null 且不写缓存（下次仍重新请求）", async () => {
    const { fetcher, calls } = createFetcher(() => {
      throw new Error("timeout");
    });
    const { service } = createTestService({ fetcher });

    expect(await service.getCovers([31], createFakePrisma())).toEqual({
      "31": null,
    });
    expect(calls).toEqual([31, 31]);

    expect(await service.getCovers([31], createFakePrisma())).toEqual({
      "31": null,
    });
    expect(calls).toEqual([31, 31, 31, 31]);
  });

  it("404 不重试，直接写负缓存", async () => {
    const { fetcher, calls } = createFetcher(() => {
      throw new CoverNotFoundError(41);
    });
    const { service } = createTestService({ fetcher });

    expect(await service.getCovers([41], createFakePrisma())).toEqual({
      "41": null,
    });
    expect(calls).toEqual([41]);
    await service.getCovers([41], createFakePrisma());
    expect(calls).toEqual([41]);
  });

  it("403 等非瞬时 4xx 不重试", async () => {
    const { fetcher, calls } = createFetcher(() => {
      throw new CoverHttpError(403, 51);
    });
    const { service } = createTestService({ fetcher });

    expect(await service.getCovers([51], createFakePrisma())).toEqual({
      "51": null,
    });
    expect(calls).toEqual([51]);
  });
});

describe("cover-service 熔断", () => {
  it("连续 10 次失败才熔断；第 9 次仍放行", async () => {
    expect(COVER_BREAKER_THRESHOLD).toBe(10);
    const clock = createFakeClock();
    const { fetcher, calls } = createFetcher(() => {
      throw new Error("network down");
    });
    const { service } = createTestService({ fetcher, clock, maxConcurrency: 1 });

    // 4 个 id ×（首次 + 1 次重试）= 8 次失败，未到阈值
    await service.getCovers([1, 2, 3, 4], createFakePrisma());
    expect(calls).toHaveLength(8);

    // 第 5 个 id 的两次尝试把连续失败推到 10 → 熔断
    await service.getCovers([5], createFakePrisma());
    expect(calls).toHaveLength(COVER_BREAKER_THRESHOLD);

    // 冷却期间不再发请求
    await service.getCovers([6], createFakePrisma());
    expect(calls).toHaveLength(COVER_BREAKER_THRESHOLD);
  });

  it("半开探测：冷却后只放行 1 个请求，成功即关闭", async () => {
    const clock = createFakeClock();
    let healthy = false;
    const { fetcher, calls } = createFetcher((id) => {
      if (!healthy) throw new Error("network down");
      return coverUrls(id);
    });
    const { service } = createTestService({
      fetcher,
      clock,
      maxConcurrency: 1,
      breakerThreshold: 2,
    });

    // 1 个 id 两次失败 → 熔断（threshold=2）
    await service.getCovers([1], createFakePrisma());
    expect(calls).toHaveLength(2);

    // 打开期间：不再请求
    await service.getCovers([2], createFakePrisma());
    expect(calls).toHaveLength(2);

    // 冷却结束：只发 1 个探测请求并成功 → 关闭熔断
    healthy = true;
    clock.advance(COVER_BREAKER_COOLDOWN_MS + 1);
    const probe = await service.getCovers([2], createFakePrisma());
    expect(calls).toHaveLength(3);
    expect(probe["2"]).toEqual(coverUrls(2));

    // 已关闭：后续正常请求放行
    const normal = await service.getCovers([3], createFakePrisma());
    expect(calls).toHaveLength(4);
    expect(normal["3"]).toEqual(coverUrls(3));
  });

  it("半开期间同一批只放行 1 个探测请求", async () => {
    const clock = createFakeClock();
    let healthy = false;
    const { fetcher, calls } = createFetcher((id) => {
      if (!healthy) throw new Error("network down");
      return coverUrls(id);
    });
    const { service } = createTestService({
      fetcher,
      clock,
      maxConcurrency: 1,
      breakerThreshold: 2,
    });

    await service.getCovers([1], createFakePrisma());
    expect(calls).toHaveLength(2);

    healthy = true;
    clock.advance(COVER_BREAKER_COOLDOWN_MS + 1);
    const result = await service.getCovers([2, 3, 4], createFakePrisma());

    // 冷却后整批只有第一个 id 拿到探测权，其余跳过；探测成功后恢复
    expect(calls).toHaveLength(3);
    expect(result["2"]).toEqual(coverUrls(2));
    expect(result["3"]).toBeNull();
    expect(result["4"]).toBeNull();

    const next = await service.getCovers([3, 4], createFakePrisma());
    expect(calls).toHaveLength(5);
    expect(next).toEqual({ "3": coverUrls(3), "4": coverUrls(4) });
  });

  it("半开探测失败：不重试、重新打开 30s", async () => {
    const clock = createFakeClock();
    let healthy = false;
    const { fetcher, calls } = createFetcher((id) => {
      if (!healthy) throw new Error("network down");
      return coverUrls(id);
    });
    const { service } = createTestService({
      fetcher,
      clock,
      maxConcurrency: 1,
      breakerThreshold: 2,
    });

    await service.getCovers([1], createFakePrisma());
    expect(calls).toHaveLength(2);

    // 冷却后探测仍失败：只发 1 次（探测不重试），重新打开
    clock.advance(COVER_BREAKER_COOLDOWN_MS + 1);
    expect(await service.getCovers([2], createFakePrisma())).toEqual({
      "2": null,
    });
    expect(calls).toHaveLength(3);

    // 重新打开期间：不再请求
    await service.getCovers([3], createFakePrisma());
    expect(calls).toHaveLength(3);

    // 第二个冷却结束且恢复：探测成功关闭
    healthy = true;
    clock.advance(COVER_BREAKER_COOLDOWN_MS + 1);
    expect((await service.getCovers([3], createFakePrisma()))["3"]).toEqual(
      coverUrls(3),
    );
    expect(calls).toHaveLength(4);
  });
});

describe("cover-service 输入清洗", () => {
  it("重复 id 去重、非法 id 过滤", async () => {
    const { fetcher, calls } = createFetcher((id) => coverUrls(id));
    const { service } = createTestService({ fetcher });

    const result = await service.getCovers(
      [2, 2, 1, -1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY],
      createFakePrisma(),
    );

    expect(calls).toEqual([2, 1]);
    expect(Object.keys(result).sort()).toEqual(["1", "2"]);
    expect(result["2"]).toEqual(coverUrls(2));
  });

  it("超过 50 个 id 截断到 50", async () => {
    const { fetcher, calls } = createFetcher((id) => coverUrls(id));
    const { service } = createTestService({ fetcher });
    const ids = Array.from({ length: 60 }, (_, index) => index + 1);

    const result = await service.getCovers(ids, createFakePrisma());

    expect(calls).toEqual(ids.slice(0, COVER_IDS_MAX));
    expect(Object.keys(result)).toHaveLength(COVER_IDS_MAX);
  });

  it("空输入返回空对象且不发请求", async () => {
    const { fetcher, calls } = createFetcher((id) => coverUrls(id));
    const { service } = createTestService({ fetcher });

    expect(await service.getCovers([], createFakePrisma())).toEqual({});
    expect(calls).toHaveLength(0);
  });
});
