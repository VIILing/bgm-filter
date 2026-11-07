/**
 * `subject.covers` / `subject.summary` 契约单测。
 *
 * 覆盖服务被 mock，绝不读取真实 `.cache/covers.db`、不联网；只验证路由把
 * `{grid, small, common, large}`（large 可为 null）原样透传给前端，以及
 * summary 的 `{id, summary}` 形状不变。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCoversMock, getSummaryMock } = vi.hoisted(() => ({
  getCoversMock: vi.fn(),
  getSummaryMock: vi.fn(),
}));

vi.mock("~/server/cover/cover-service", () => ({
  getCovers: getCoversMock,
  getSummary: getSummaryMock,
}));

import { createCallerFactory } from "~/server/api/trpc";

import { subjectRouter } from "./subject";

const createCaller = createCallerFactory(subjectRouter);
const caller = createCaller({ db: null as never, headers: new Headers() });

beforeEach(() => {
  getCoversMock.mockReset();
  getSummaryMock.mockReset();
});

describe("subject.covers 契约", () => {
  it("返回 large 与三种回退尺寸，无封面条目为 null", async () => {
    const cover = {
      grid: "https://lain.bgm.tv/r/100/pic/cover/l/aa/bb/1_x.jpg",
      small: "https://lain.bgm.tv/r/200/pic/cover/l/aa/bb/1_x.jpg",
      common: "https://lain.bgm.tv/r/400/pic/cover/l/aa/bb/1_x.jpg",
      large: "https://lain.bgm.tv/pic/cover/l/aa/bb/1_x.jpg",
    };
    getCoversMock.mockResolvedValue({ "1": cover, "2": null });

    await expect(caller.covers({ ids: [1, 2] })).resolves.toEqual({
      "1": cover,
      "2": null,
    });
    expect(getCoversMock).toHaveBeenCalledWith([1, 2]);
  });

  it("旧缓存行无法推导 large 时字段为 null（前端回退 common）", async () => {
    const cover = {
      grid: "g",
      small: "s",
      common: "c",
      large: null,
    };
    getCoversMock.mockResolvedValue({ "5": cover });

    await expect(caller.covers({ ids: [5] })).resolves.toEqual({ "5": cover });
  });
});

describe("subject.summary 契约", () => {
  it("返回 {id, summary}，summary 可为 null", async () => {
    getSummaryMock.mockResolvedValue("一段简介");

    await expect(caller.summary({ id: 7 })).resolves.toEqual({
      id: 7,
      summary: "一段简介",
    });
    expect(getSummaryMock).toHaveBeenCalledWith(7);
  });
});
