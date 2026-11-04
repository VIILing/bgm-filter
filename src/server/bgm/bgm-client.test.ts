/**
 * `BgmClient` 单测：注入 fetch + 假时钟，不联网。
 *
 * 覆盖：鉴权头 / UA / Accept、404 映射、重试策略、熔断（10 次 / 30s 半开单探测）、
 * 令牌桶限速 + 并发上限、错误信息脱敏。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BGM_BREAKER_COOLDOWN_MS,
  BGM_BREAKER_THRESHOLD,
  BGM_BURST_CAPACITY,
  BGM_MAX_CONCURRENCY,
  BGM_REQUESTS_PER_SECOND,
  BgmCircuitOpenError,
  BgmClient,
  BgmHttpError,
  BgmNetworkError,
  type BgmClientOptions,
  type BgmClock,
  type BgmFetch,
} from "./bgm-client";

interface FakeClock extends BgmClock {
  advance(ms: number): void;
}

/** 虚拟时间：sleep 先让出真实宏任务，再拨表；避免真等限速/退避。 */
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

function createFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): { fetchImpl: BgmFetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl: BgmFetch = async (url, init) => {
    calls.push({ url, init });
    return await handler(url, init);
  };
  return { fetchImpl, calls };
}

function createTestClient(options: BgmClientOptions = {}): {
  client: BgmClient;
  clock: FakeClock;
  warn: ReturnType<typeof vi.fn>;
} {
  const clock = (options.clock as FakeClock | undefined) ?? createFakeClock();
  const warn = vi.fn();
  const client = new BgmClient({
    token: null,
    retryDelayMs: () => 0,
    createTimeoutSignal: () => new AbortController().signal,
    warn,
    ...options,
    clock,
  });
  return { client, clock, warn };
}

function headerOf(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("BgmClient 请求头与 URL", () => {
  it("有 token：UA / Accept / Authorization 正确，路径拼到 baseUrl", async () => {
    const { fetchImpl, calls } = createFetch(() =>
      jsonResponse({ id: 1, name: "测试" }),
    );
    const { client } = createTestClient({
      token: "secret-token",
      fetch: fetchImpl,
    });

    const subject = await client.getSubject(1);

    expect(subject).toEqual({ id: 1, name: "测试" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.bgm.tv/v0/subjects/1");
    expect(headerOf(calls[0]!.init, "Authorization")).toBe(
      "Bearer secret-token",
    );
    expect(headerOf(calls[0]!.init, "User-Agent")).toContain("bgm-filter");
    expect(headerOf(calls[0]!.init, "Accept")).toBe("application/json");
    expect(calls[0]!.init.cache).toBe("no-store");
  });

  it("无 token：不带 Authorization", async () => {
    const { fetchImpl, calls } = createFetch(() =>
      jsonResponse({ id: 1, name: "匿名" }),
    );
    const { client } = createTestClient({ token: "", fetch: fetchImpl });

    await client.getSubject(1);

    expect(headerOf(calls[0]!.init, "Authorization")).toBeNull();
    expect(headerOf(calls[0]!.init, "User-Agent")).toContain("bgm-filter");
  });

  it("默认从 process.env.BGM_API_TOKEN 读取；构造参数可覆盖", async () => {
    vi.stubEnv("BGM_API_TOKEN", "env-token");
    const fromEnv = createFetch(() => jsonResponse({ id: 1, name: "x" }));
    const envClient = createTestClient({
      token: undefined,
      fetch: fromEnv.fetchImpl,
    }).client;
    await envClient.getSubject(1);
    expect(headerOf(fromEnv.calls[0]!.init, "Authorization")).toBe(
      "Bearer env-token",
    );

    const overridden = createFetch(() => jsonResponse({ id: 2, name: "y" }));
    const overrideClient = createTestClient({
      token: "explicit-token",
      fetch: overridden.fetchImpl,
    }).client;
    await overrideClient.getSubject(2);
    expect(headerOf(overridden.calls[0]!.init, "Authorization")).toBe(
      "Bearer explicit-token",
    );
  });

  it("token 前后空白会被去掉", async () => {
    const { fetchImpl, calls } = createFetch(() =>
      jsonResponse({ id: 1, name: "x" }),
    );
    const { client } = createTestClient({
      token: "  padded-token  ",
      fetch: fetchImpl,
    });

    await client.getSubject(1);

    expect(headerOf(calls[0]!.init, "Authorization")).toBe(
      "Bearer padded-token",
    );
  });

  it("baseUrl 可覆盖且去掉末尾斜杠；request 接受无前导斜杠路径", async () => {
    const { fetchImpl, calls } = createFetch(() =>
      jsonResponse({ ok: true }),
    );
    const { client } = createTestClient({
      baseUrl: "https://example.test/api/",
      fetch: fetchImpl,
    });

    await client.request("v0/subjects/1");

    expect(calls[0]!.url).toBe("https://example.test/api/v0/subjects/1");
  });

  it("拒绝绝对 URL（避免 token 被发往其它主机）", async () => {
    const { fetchImpl, calls } = createFetch(() =>
      jsonResponse({ ok: true }),
    );
    const { client } = createTestClient({
      token: "secret-token",
      fetch: fetchImpl,
    });

    await expect(
      client.request("https://evil.example/steal"),
    ).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });
});

describe("BgmClient 状态映射与重试", () => {
  it("404 → getSubject 返回 null，且不重试", async () => {
    const { fetchImpl, calls } = createFetch(
      () => new Response("not found", { status: 404 }),
    );
    const { client } = createTestClient({
      token: "secret-token",
      fetch: fetchImpl,
    });

    await expect(client.getSubject(99999999)).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("500 重试 1 次后抛 BgmHttpError(500)", async () => {
    const { fetchImpl, calls } = createFetch(
      () => new Response("server error", { status: 503 }),
    );
    const { client } = createTestClient({ fetch: fetchImpl });

    const error = await client.getSubject(1).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(BgmHttpError);
    expect((error as BgmHttpError).status).toBe(503);
    expect(calls).toHaveLength(2);
  });

  it("网络错误重试 1 次成功后返回数据", async () => {
    let attempts = 0;
    const { fetchImpl, calls } = createFetch(() => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("fetch failed");
      return jsonResponse({ id: 7, name: "retry-ok" });
    });
    const { client } = createTestClient({ fetch: fetchImpl });

    await expect(client.getSubject(7)).resolves.toEqual({
      id: 7,
      name: "retry-ok",
    });
    expect(calls).toHaveLength(2);
  });

  it("重试耗尽抛 BgmNetworkError，且不重试第二次", async () => {
    const { fetchImpl, calls } = createFetch(() => {
      throw new TypeError("ECONNRESET");
    });
    const { client } = createTestClient({ fetch: fetchImpl });

    const error = await client.getSubject(1).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(BgmNetworkError);
    expect(calls).toHaveLength(2);
  });

  it("403 等确定性 4xx 不重试", async () => {
    const { fetchImpl, calls } = createFetch(
      () => new Response("forbidden", { status: 403 }),
    );
    const { client } = createTestClient({ fetch: fetchImpl });

    const error = await client.getSubject(1).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(BgmHttpError);
    expect((error as BgmHttpError).status).toBe(403);
    expect(calls).toHaveLength(1);
  });

  it("404 不计入熔断失败（确定性结果，源站可达）", async () => {
    const { fetchImpl, calls } = createFetch(
      () => new Response("not found", { status: 404 }),
    );
    const { client } = createTestClient({
      fetch: fetchImpl,
      breakerThreshold: 1,
    });

    await expect(client.getSubject(1)).resolves.toBeNull();
    await expect(client.getSubject(2)).resolves.toBeNull();
    expect(calls).toHaveLength(2);
  });
});

describe("BgmClient 熔断", () => {
  it("连续 10 次失败才打开；打开后不再发请求", async () => {
    expect(BGM_BREAKER_THRESHOLD).toBe(10);
    const { fetchImpl, calls } = createFetch(() => {
      throw new TypeError("network down");
    });
    const { client, clock } = createTestClient({
      fetch: fetchImpl,
      maxConcurrency: 1,
    });

    // 5 个 id ×（首次 + 1 次重试）= 10 次失败 → 熔断
    for (const id of [1, 2, 3, 4, 5]) {
      await expect(client.getSubject(id)).rejects.toBeInstanceOf(
        BgmNetworkError,
      );
    }
    expect(calls).toHaveLength(BGM_BREAKER_THRESHOLD);

    // 冷却期间：直接短路，不产生任何外部请求
    await expect(client.getSubject(6)).rejects.toBeInstanceOf(
      BgmCircuitOpenError,
    );
    expect(calls).toHaveLength(BGM_BREAKER_THRESHOLD);

    // 冷却结束后恢复第一个请求的准入（仍失败则继续打开）
    clock.advance(BGM_BREAKER_COOLDOWN_MS + 1);
    await expect(client.getSubject(7)).rejects.toBeInstanceOf(
      BgmNetworkError,
    );
    // 半开探测不重试：只多 1 次请求，失败后重新打开
    expect(calls).toHaveLength(BGM_BREAKER_THRESHOLD + 1);
  });

  it("半开探测成功即关闭熔断，后续请求恢复正常", async () => {
    const clock = createFakeClock();
    let healthy = false;
    const { fetchImpl, calls } = createFetch(() => {
      if (!healthy) throw new TypeError("network down");
      return jsonResponse({ id: 1, name: "ok" });
    });
    const { client } = createTestClient({
      fetch: fetchImpl,
      clock,
      breakerThreshold: 2,
      maxConcurrency: 1,
    });

    await expect(client.getSubject(1)).rejects.toBeInstanceOf(
      BgmNetworkError,
    );
    expect(calls).toHaveLength(2);
    await expect(client.getSubject(2)).rejects.toBeInstanceOf(
      BgmCircuitOpenError,
    );
    expect(calls).toHaveLength(2);

    healthy = true;
    clock.advance(BGM_BREAKER_COOLDOWN_MS + 1);
    await expect(client.getSubject(2)).resolves.toEqual({
      id: 1,
      name: "ok",
    });
    expect(calls).toHaveLength(3);

    await expect(client.getSubject(3)).resolves.toEqual({
      id: 1,
      name: "ok",
    });
    expect(calls).toHaveLength(4);
  });

  it("半开期间只放行 1 个探测请求", async () => {
    const clock = createFakeClock();
    let healthy = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fetchImpl, calls } = createFetch(async () => {
      if (!healthy) throw new TypeError("network down");
      await gate;
      return jsonResponse({ id: 1, name: "ok" });
    });
    const { client } = createTestClient({
      fetch: fetchImpl,
      clock,
      breakerThreshold: 2,
      maxConcurrency: 1,
    });

    await expect(client.getSubject(1)).rejects.toBeInstanceOf(
      BgmNetworkError,
    );
    healthy = true;
    clock.advance(BGM_BREAKER_COOLDOWN_MS + 1);

    const probe = client.getSubject(2);
    // 让探测请求先进入在途状态
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await expect(client.getSubject(3)).rejects.toBeInstanceOf(
      BgmCircuitOpenError,
    );
    release();
    await expect(probe).resolves.toEqual({ id: 1, name: "ok" });

    // 探测成功关闭后，后面的请求可正常发车
    await expect(client.getSubject(4)).resolves.toEqual({
      id: 1,
      name: "ok",
    });
    expect(calls).toHaveLength(4);
  });
});

describe("BgmClient 限速与并发", () => {
  it("并发 ≤5，前 4 个突发，之后平均 4 req/s", async () => {
    expect(BGM_REQUESTS_PER_SECOND).toBe(4);
    expect(BGM_BURST_CAPACITY).toBe(4);

    const clock = createFakeClock();
    const ids = Array.from({ length: 14 }, (_, index) => 100 + index);
    const starts: number[] = [];
    let active = 0;
    let maxActive = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const { fetchImpl } = createFetch(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      starts.push(clock.now());
      await gate;
      active -= 1;
      return jsonResponse({ id: 1, name: "ok" });
    });
    const { client } = createTestClient({ fetch: fetchImpl, clock });

    const promise = Promise.all(ids.map((id) => client.getSubject(id)));
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    // 突发 4 个立即发车；250ms 后补充第 5 个令牌，凑满并发上限 5
    expect(starts).toHaveLength(BGM_MAX_CONCURRENCY);
    expect(maxActive).toBe(BGM_MAX_CONCURRENCY);

    release();
    await promise;

    expect(maxActive).toBeLessThanOrEqual(BGM_MAX_CONCURRENCY);

    const sorted = [...starts].sort((a, b) => a - b);
    // 前 4 个走突发令牌，虚拟时间相同
    expect(new Set(sorted.slice(0, BGM_BURST_CAPACITY)).size).toBe(1);
    // 令牌耗尽后按 4 req/s（250ms/个）补充
    for (
      let index = BGM_BURST_CAPACITY;
      index < sorted.length;
      index += 1
    ) {
      expect(sorted[index]! - sorted[index - 1]!).toBeGreaterThanOrEqual(
        1000 / BGM_REQUESTS_PER_SECOND,
      );
    }
  });
});

describe("BgmClient summary 透传", () => {
  it("getSubject 原样透传官方 summary 字段", async () => {
    const { fetchImpl } = createFetch(() =>
      jsonResponse({ id: 1, name: "x", summary: "一段简介" }),
    );
    const { client } = createTestClient({ fetch: fetchImpl });

    await expect(client.getSubject(1)).resolves.toEqual({
      id: 1,
      name: "x",
      summary: "一段简介",
    });
  });

  it("官方缺 summary 时返回体不含该字段（可选）", async () => {
    const { fetchImpl } = createFetch(() => jsonResponse({ id: 2, name: "y" }));
    const { client } = createTestClient({ fetch: fetchImpl });

    await expect(client.getSubject(2)).resolves.toEqual({ id: 2, name: "y" });
  });
});

describe("BgmClient 错误信息脱敏", () => {
  const secret = "super-secret-token";

  it("网络异常原文若含 token，也不会进入对外错误信息", async () => {
    const { fetchImpl } = createFetch(() => {
      throw new Error(`boom ${secret}`);
    });
    const { client, warn } = createTestClient({
      token: secret,
      fetch: fetchImpl,
    });

    const error = await client.getSubject(1).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(BgmNetworkError);
    expect(String((error as Error).message)).not.toContain(secret);
    expect(String((error as Error).stack ?? "")).not.toContain(secret);
    for (const call of warn.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(secret);
    }
  });

  it("HTTP 错误只带状态与路径，不带响应体 / token", async () => {
    const { fetchImpl } = createFetch(
      () =>
        new Response(`upstream said ${secret}`, {
          status: 500,
          headers: { "content-type": "text/plain" },
        }),
    );
    const { client } = createTestClient({ token: secret, fetch: fetchImpl });

    const error = await client.request(`/v0/x?key=${secret}`).catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(BgmHttpError);
    expect((error as BgmHttpError).status).toBe(500);
    expect((error as BgmHttpError).path).toContain("[redacted]");
    expect(String((error as Error).message)).not.toContain(secret);
  });

  it("熔断日志不含 token", async () => {
    const { fetchImpl } = createFetch(() => {
      throw new TypeError("down");
    });
    const { client, warn } = createTestClient({
      token: secret,
      fetch: fetchImpl,
      breakerThreshold: 1,
    });

    await expect(client.getSubject(1)).rejects.toBeInstanceOf(
      BgmNetworkError,
    );
    expect(warn).toHaveBeenCalled();
    for (const call of warn.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(secret);
    }
  });
});
