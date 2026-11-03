/**
 * `cover-service` 单测：fake `BgmClient` + 假时钟 + `:memory:` 缓存，
 * 不联网、不碰真实 `.cache/covers.db` / `prisma/dev.db`。
 *
 * 限速 / 重试 / 熔断已迁到 `bgm-client.test.ts`；这里只验证服务层行为：
 * 缓存、分级 TTL、输入清洗、images 回退、失败不写缓存、单条失败隔离。
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  BgmCircuitOpenError,
  BgmHttpError,
  type BgmSubject,
} from "~/server/bgm/bgm-client";

import {
  COVER_IDS_MAX,
  type CoverUrls,
} from "~/shared/subject-contract";

import {
  COVER_NEGATIVE_TTL_MS,
  COVER_NOT_FOUND_TTL_MS,
  createCoverService,
  pickCoverUrls,
  type CoverClient,
  type CoverClock,
  type CoverService,
  type CoverServiceOptions,
} from "./cover-service";

interface FakeClock extends CoverClock {
  advance(ms: number): void;
}

function createFakeClock(start = 1_700_000_000_000): FakeClock {
  let current = start;
  return {
    now: () => current,
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

function subjectFor(id: number): BgmSubject {
  return {
    id,
    name: `subject ${id}`,
    name_cn: `条目 ${id}`,
    images: coverUrls(id),
  };
}

function subjectWithoutImages(id: number): BgmSubject {
  return {
    id,
    name: `subject ${id}`,
    images: { grid: "", small: "", common: "" },
  };
}

/** 记录调用次数的 fake 客户端；handler 可返回 null（404）或抛错。 */
function createFakeClient(
  handler: (id: number) => BgmSubject | null | Promise<BgmSubject | null>,
): { client: CoverClient; calls: number[] } {
  const calls: number[] = [];
  const client: CoverClient = {
    getSubject: async (id) => {
      calls.push(id);
      return await handler(id);
    },
  };
  return { client, calls };
}

const services: CoverService[] = [];

function createTestService(options: CoverServiceOptions = {}): {
  service: CoverService;
  clock: FakeClock;
} {
  const clock = (options.clock as FakeClock | undefined) ?? createFakeClock();
  const service = createCoverService({
    cachePath: ":memory:",
    warn: () => {},
    ...options,
    clock,
  });
  services.push(service);
  return { service, clock };
}

afterEach(() => {
  for (const service of services.splice(0)) service.close();
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
    const { client, calls } = createFakeClient((id) => subjectFor(id));
    const { service } = createTestService({ client });

    const first = await service.getCovers([1]);
    const second = await service.getCovers([1]);

    expect(calls).toEqual([1]);
    expect(first).toEqual({ "1": coverUrls(1) });
    expect(second).toEqual(first);
  });

  it("正缓存永久有效（不受负缓存 TTL 影响）", async () => {
    const { client, calls } = createFakeClient((id) => subjectFor(id));
    const { service, clock } = createTestService({ client });

    await service.getCovers([1]);
    clock.advance(365 * 24 * 60 * 60 * 1000);
    await service.getCovers([1]);

    expect(calls).toEqual([1]);
  });

  it("负缓存：确认无封面后不再请求", async () => {
    const { client, calls } = createFakeClient((id) =>
      subjectWithoutImages(id),
    );
    const { service } = createTestService({ client });

    expect(await service.getCovers([7])).toEqual({ "7": null });
    expect(await service.getCovers([7])).toEqual({ "7": null });
    expect(calls).toEqual([7]);
  });

  it("负缓存 TTL 7 天：过期后重新请求", async () => {
    const { client, calls } = createFakeClient((id) =>
      subjectWithoutImages(id),
    );
    const { service, clock } = createTestService({ client });

    await service.getCovers([7]);
    expect(calls).toHaveLength(1);

    clock.advance(COVER_NEGATIVE_TTL_MS - 1_000);
    await service.getCovers([7]);
    expect(calls).toHaveLength(1);

    clock.advance(2_000);
    await service.getCovers([7]);
    expect(calls).toHaveLength(2);
  });

  it("404（getSubject → null）写负缓存，不重复请求", async () => {
    const { client, calls } = createFakeClient(() => null);
    const { service } = createTestService({ client });

    expect(await service.getCovers([9])).toEqual({ "9": null });
    expect(await service.getCovers([9])).toEqual({ "9": null });
    expect(calls).toEqual([9]);
  });

  it("404 负缓存 TTL 1 天：过期后重新请求", async () => {
    const { client, calls } = createFakeClient(() => null);
    const { service, clock } = createTestService({ client });

    await service.getCovers([19]);
    expect(calls).toHaveLength(1);

    clock.advance(COVER_NOT_FOUND_TTL_MS - 1_000);
    await service.getCovers([19]);
    expect(calls).toHaveLength(1);

    clock.advance(2_000);
    await service.getCovers([19]);
    expect(calls).toHaveLength(2);
  });

  it("无图负缓存不会被 404 的 1 天 TTL 提前清掉", async () => {
    const { client, calls } = createFakeClient((id) =>
      subjectWithoutImages(id),
    );
    const { service, clock } = createTestService({ client });

    await service.getCovers([29]);
    expect(calls).toHaveLength(1);

    // 超过 404 的 1 天 TTL，但仍远小于无图的 7 天 TTL
    clock.advance(COVER_NOT_FOUND_TTL_MS + 60 * 60 * 1000);
    await service.getCovers([29]);
    expect(calls).toHaveLength(1);
  });

  it("临时网络失败不写负缓存，下次会重试", async () => {
    let broken = true;
    const { client, calls } = createFakeClient((id) => {
      if (broken) throw new Error("ECONNRESET");
      return subjectFor(id);
    });
    const { service } = createTestService({ client });

    expect(await service.getCovers([3])).toEqual({ "3": null });
    broken = false;
    expect(await service.getCovers([3])).toEqual({ "3": coverUrls(3) });
    // 每次 getCovers 只调用一次 getSubject（重试已由 BgmClient 内部完成）
    expect(calls).toEqual([3, 3]);
  });

  it("非 404 的 HTTP 失败（如 403）也不写缓存", async () => {
    let forbidden = true;
    const { client, calls } = createFakeClient((id) => {
      if (forbidden) throw new BgmHttpError(403, `/v0/subjects/${id}`);
      return subjectFor(id);
    });
    const { service } = createTestService({ client });

    expect(await service.getCovers([51])).toEqual({ "51": null });
    forbidden = false;
    expect(await service.getCovers([51])).toEqual({ "51": coverUrls(51) });
    expect(calls).toEqual([51, 51]);
  });

  it("熔断短路不写缓存：恢复后同 id 仍会回源", async () => {
    let open = true;
    const { client, calls } = createFakeClient((id) => {
      if (open) throw new BgmCircuitOpenError(`/v0/subjects/${id}`);
      return subjectFor(id);
    });
    const { service } = createTestService({ client });

    expect(await service.getCovers([5])).toEqual({ "5": null });
    open = false;
    expect(await service.getCovers([5])).toEqual({ "5": coverUrls(5) });
    expect(calls).toEqual([5, 5]);
  });

  it("单条失败不影响同批其它 id", async () => {
    const { client } = createFakeClient((id) => {
      if (id === 2) throw new Error("boom");
      return subjectFor(id);
    });
    const { service } = createTestService({ client });

    expect(await service.getCovers([1, 2, 3])).toEqual({
      "1": coverUrls(1),
      "2": null,
      "3": coverUrls(3),
    });
  });
});

describe("cover-service NSFW 策略（已取消限制）", () => {
  it("NSFW id 与普通 id 一样回源并返回 URL", async () => {
    const { client, calls } = createFakeClient((id) => subjectFor(id));
    const { service } = createTestService({ client });

    const result = await service.getCovers([22290, 226254]);

    expect([...calls].sort((a, b) => a - b)).toEqual([22290, 226254]);
    expect(result["22290"]).toEqual(coverUrls(22290));
    expect(result["226254"]).toEqual(coverUrls(226254));
  });
});

describe("cover-service 客户端注入", () => {
  it("getCovers(ids, deps) 可临时覆盖默认客户端", async () => {
    const fallback = createFakeClient((id) => subjectFor(id));
    const override = createFakeClient(() => subjectFor(2));
    const { service } = createTestService({ client: fallback.client });

    const result = await service.getCovers([9], { client: override.client });

    expect(result["9"]).toEqual(coverUrls(2));
    expect(override.calls).toEqual([9]);
    expect(fallback.calls).toEqual([]);
  });
});

describe("cover-service 输入清洗", () => {
  it("重复 id 去重、非法 id 过滤", async () => {
    const { client, calls } = createFakeClient((id) => subjectFor(id));
    const { service } = createTestService({ client });

    const result = await service.getCovers([
      2,
      2,
      1,
      -1,
      0,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]);

    expect(calls).toEqual([2, 1]);
    expect(Object.keys(result).sort()).toEqual(["1", "2"]);
    expect(result["2"]).toEqual(coverUrls(2));
  });

  it("超过 50 个 id 截断到 50", async () => {
    const { client, calls } = createFakeClient((id) => subjectFor(id));
    const { service } = createTestService({ client });
    const ids = Array.from({ length: 60 }, (_, index) => index + 1);

    const result = await service.getCovers(ids);

    expect(calls).toEqual(ids.slice(0, COVER_IDS_MAX));
    expect(Object.keys(result)).toHaveLength(COVER_IDS_MAX);
  });

  it("空输入返回空对象且不发请求", async () => {
    const { client, calls } = createFakeClient((id) => subjectFor(id));
    const { service } = createTestService({ client });

    expect(await service.getCovers([])).toEqual({});
    expect(calls).toHaveLength(0);
  });
});
