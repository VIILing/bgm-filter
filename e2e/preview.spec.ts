import { expect, test, type Page } from "@playwright/test";

import {
  DIALOG,
  expectDialogClosed,
  expectFocusOnTrigger,
  openDialog,
  PANEL,
  ROW,
} from "./dialog-helpers";

/** 收集 console error 与 pageerror，测试结束断言为 0。 */
function collectErrors(page: Page): { consoleErrors: string[]; pageErrors: string[] } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  return { consoleErrors, pageErrors };
}

test("首页加载 50 条结果卡片", async ({ page }) => {
  const errs = collectErrors(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const rows = page.locator(ROW);
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  await expect(rows).toHaveCount(50);

  expect(errs.consoleErrors).toEqual([]);
  expect(errs.pageErrors).toEqual([]);
});

test("点击条目打开弹窗：骨架 → 内容；点面板不关闭、滚轮不带动页面；Esc 关闭并还原焦点", async ({
  page,
}) => {
  const errs = collectErrors(page);

  // 延迟 summary，确定性观察「正在加载简介…」骨架态。
  await page.route("**/*subject.summary*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(ROW).first()).toBeVisible({ timeout: 30_000 });
  await openDialog(page, 2);

  const summary = page.locator("[data-preview-summary]");
  await expect(summary).toContainText("正在加载简介", { timeout: 5_000 });

  const panel = page.locator(PANEL);
  const boxBefore = await panel.boundingBox();

  await expect(summary).not.toContainText("正在加载简介", { timeout: 20_000 });
  const summaryText = (await summary.textContent()) ?? "";
  expect(summaryText.trim().length).toBeGreaterThan(0);

  // 加载完成不改变面板几何
  const boxAfter = await panel.boundingBox();
  expect(boxAfter).toEqual(boxBefore);

  const tags = page.locator("[data-preview-tags]");
  await expect(tags).toBeVisible();
  expect(await tags.locator("span").count()).toBeGreaterThan(0);

  // 点击面板不关闭、不跳转
  const urlBefore = page.url();
  const pagesBefore = page.context().pages().length;
  await panel.click({ position: { x: 60, y: 60 } });
  await expect(page.locator(DIALOG)).toBeVisible();
  expect(page.url()).toBe(urlBefore);
  expect(page.context().pages().length).toBe(pagesBefore);

  // 面板内滚轮不带动页面（页面已锁定）
  const scrollYBefore = await page.evaluate(() => window.scrollY);
  await summary.hover();
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollYBefore);

  await page.keyboard.press("Escape");
  await expectDialogClosed(page);
  await expectFocusOnTrigger(page);

  expect(errs.consoleErrors).toEqual([]);
  expect(errs.pageErrors).toEqual([]);
});

test("悬浮不再出现弹窗、不再请求 preview/summary/原图", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(ROW).first()).toBeVisible({ timeout: 30_000 });

  const probes: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("subject.preview") || url.includes("subject.summary")) probes.push(url);
    if (url.includes("lain.bgm.tv") && !url.includes("/r/")) probes.push(`LARGE ${url}`);
  });

  await page.locator(ROW).nth(2).hover({ position: { x: 40, y: 8 } });
  await page.waitForTimeout(700);

  expect(probes).toEqual([]);
  await expect(page.locator(DIALOG)).toHaveCount(0);
});

test("点击行内标签 chip 仍追加筛选，不打开弹窗", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const rows = page.locator(ROW);
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });

  const tagInput = page.locator("input").first();
  await expect(tagInput).toHaveValue("");

  await rows.first().locator("button").first().click();
  await expect(tagInput).not.toHaveValue("");
  await expect(page.locator(DIALOG)).toHaveCount(0);
});
