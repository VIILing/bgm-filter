import { expect, test } from "@playwright/test";

import {
  DIALOG,
  expectCoverVisible,
  expectDialogClosed,
  expectPlaceholderHidden,
  openDialog,
  PANEL,
  ROW,
} from "./dialog-helpers";

/**
 * P1 回归：暖缓存下反复打开同一条目，封面不能因 effect/onLoad 竞态停留在 opacity:0。
 * 修复前第二次打开必现（img complete、naturalWidth>0，但灰色占位）。
 */
test("同一条目反复打开 5 次：缓存封面每次都可见", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const rows = page.locator(ROW);
  await expect(rows).toHaveCount(50, { timeout: 30_000 });
  // 先等列表封面进入 covers map，弹窗走「复用列表封面」路径。
  await expect(rows.first().locator("img")).toHaveCount(1, { timeout: 30_000 });

  for (let i = 0; i < 5; i += 1) {
    await openDialog(page, 0);
    await expectCoverVisible(page);
    await expectPlaceholderHidden(page);
    await page.keyboard.press("Escape");
    await expectDialogClosed(page);
  }

  await openDialog(page, 0);
  await expectCoverVisible(page);
  await expectPlaceholderHidden(page);
  const firstCoverSrc = await page.locator(`${PANEL} img`).getAttribute("src");
  await page.keyboard.press("Escape");
  await expectDialogClosed(page);

  // 切换到另一条再回来：封面应换成另一张，回来后仍是第一张且可见。
  await openDialog(page, 1);
  await expect(page.locator(`${PANEL} h3`)).not.toHaveText("", { timeout: 10_000 });
  await expect(page.locator(`${PANEL} img`)).not.toHaveAttribute("src", firstCoverSrc ?? "", {
    timeout: 10_000,
  });
  await expectCoverVisible(page);
  await expectPlaceholderHidden(page);
  await page.keyboard.press("Escape");
  await expectDialogClosed(page);

  await openDialog(page, 0);
  await expect(page.locator(`${PANEL} img`)).toHaveAttribute("src", firstCoverSrc ?? "", {
    timeout: 10_000,
  });
  await expectCoverVisible(page);
  await expectPlaceholderHidden(page);
});

/**
 * P2 回归：非 2:3 封面（方形专辑）加载完成后，图片上下留白处不能残留 2:3 灰色占位。
 */
test("非 2:3 封面加载后占位隐藏，槽内为白色留白", async ({ page }) => {
  await page.goto(`/?q=${encodeURIComponent("さくら、もゆ")}`, { waitUntil: "domcontentloaded" });
  const rows = page.locator(ROW);
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  await expect(rows.first().locator("img")).toHaveCount(1, { timeout: 30_000 });

  await openDialog(page, 0);
  await expectCoverVisible(page);
  await expectPlaceholderHidden(page);

  // 第一条是方形专辑：图片高度明显小于封面槽，若占位未隐藏就会露出上下灰块。
  const geometry = await page.evaluate(() => {
    const panel = document.querySelector("[data-subject-dialog-panel]") as HTMLElement;
    const slot = panel.children[0]!.children[0]!.getBoundingClientRect();
    const img = panel.querySelector("img")!.getBoundingClientRect();
    return { slotHeight: slot.height, imgHeight: img.height };
  });
  expect(geometry.imgHeight).toBeLessThan(geometry.slotHeight - 40);
});
