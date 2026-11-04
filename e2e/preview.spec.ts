import { expect, test, type Page } from "@playwright/test";

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

const ROW = 'ul[aria-label="条目结果"] > li';

test("首页加载 50 条结果卡片", async ({ page }) => {
  const errs = collectErrors(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const rows = page.locator(ROW);
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  await expect(rows).toHaveCount(50);

  expect(errs.consoleErrors).toEqual([]);
  expect(errs.pageErrors).toEqual([]);
});

test("悬浮预览：面板出现 + 骨架「正在加载简介…」→ 简介/暂无 + 标签", async ({ page }) => {
  const errs = collectErrors(page);

  // 延迟 summary 所在批次 2.5s，确定性观察「正在加载简介…」骨架态
  // （暖缓存下该骨架一闪而过属预期：封面加载已预热 summary）。
  await page.route("**/*subject.summary*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.continue();
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const row = page.locator(ROW).nth(2);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.hover();

  // 面板出现
  await expect(page.locator("[data-hover-preview]")).toBeVisible({ timeout: 5_000 });

  const summary = page.locator("[data-preview-summary]");

  // 骨架态
  await expect(summary).toContainText("正在加载简介", { timeout: 5_000 });

  // 完成态：骨架消失，有简介文本或「暂无简介」
  await expect(summary).not.toContainText("正在加载简介", { timeout: 20_000 });
  const summaryText = (await summary.textContent()) ?? "";
  expect(summaryText.trim().length).toBeGreaterThan(0);
  expect(summaryText.includes("暂无简介") || summaryText.trim().length > 0).toBe(true);

  // 标签区渲染
  const tags = page.locator("[data-preview-tags]");
  await expect(tags).toBeVisible();
  expect(await tags.locator("span").count()).toBeGreaterThan(0);

  expect(errs.consoleErrors).toEqual([]);
  expect(errs.pageErrors).toEqual([]);
});

test("点击面板不跳转 + 滚轮归内部容器", async ({ page }) => {
  const errs = collectErrors(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const row = page.locator(ROW).nth(1);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.hover();

  await expect(page.locator("[data-hover-preview]")).toBeVisible({ timeout: 5_000 });
  const summary = page.locator("[data-preview-summary]");
  // 等简介完成，避免在骨架态点击
  await expect(summary).not.toContainText("正在加载简介", { timeout: 20_000 });

  // 点击面板不触发外链跳转
  const urlBefore = page.url();
  const pagesBefore = page.context().pages().length;
  await summary.click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(400);
  expect(page.url()).toBe(urlBefore);
  expect(page.context().pages().length).toBe(pagesBefore);

  // 面板内滚轮：页面 scrollY 不变（滚轮被面板吞掉，只滚内部容器）
  const scrollYBefore = await page.evaluate(() => window.scrollY);
  await summary.hover();
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollYBefore);

  // 移出面板后：页面滚轮正常滚动
  await page.mouse.move(40, 40);
  await page.waitForTimeout(400); // 等面板关闭
  const y0 = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 800);
  await page.waitForTimeout(400);
  const y1 = await page.evaluate(() => window.scrollY);
  expect(y1).toBeGreaterThan(y0);

  expect(errs.consoleErrors).toEqual([]);
  expect(errs.pageErrors).toEqual([]);
});
