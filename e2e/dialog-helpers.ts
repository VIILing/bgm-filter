import { expect, type Page } from "@playwright/test";

export const ROW = 'ul[aria-label="条目结果"] > li';
export const DIALOG = "[data-subject-dialog]";
export const PANEL = "[data-subject-dialog-panel]";
export const JUMP = "[data-subject-dialog-jump]";
export const OVERLAY = "[data-subject-dialog-overlay]";

/** 点击第 index 行的整卡链接，等弹窗完成 150ms 打开动画（opacity=1）。 */
export async function openDialog(page: Page, index = 0): Promise<void> {
  const row = page.locator(ROW).nth(index);
  await row.locator('a[href*="/subject/"]').first().click();
  await expect(page.locator(DIALOG)).toBeVisible({ timeout: 10_000 });
  // 等 160/220ms 动画真正结束（reduced-motion 下 transform 为 none），不依赖固定 sleep。
  await expect
    .poll(
      async () =>
        page.locator(PANEL).evaluate((el: HTMLElement) => {
          const style = getComputedStyle(el);
          return (
            Number(style.opacity) === 1 &&
            (style.transform === "none" || style.transform === "matrix(1, 0, 0, 1, 0, 0)")
          );
        }),
      { timeout: 5_000 },
    )
    .toBe(true);
}

/** 关闭动画 150ms 结束后弹窗卸载。 */
export async function expectDialogClosed(page: Page): Promise<void> {
  await expect(page.locator(DIALOG)).toHaveCount(0, { timeout: 5_000 });
}

/** 封面 img 真正可见：complete + naturalWidth > 0 + opacity:1。 */
export async function expectCoverVisible(page: Page): Promise<void> {
  const img = page.locator(`${PANEL} img`);
  await expect(img).toHaveCount(1, { timeout: 20_000 });
  await expect
    .poll(async () => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), {
      timeout: 20_000,
    })
    .toBe(true);
  await expect
    .poll(async () => img.evaluate((el: HTMLImageElement) => getComputedStyle(el).opacity), {
      timeout: 5_000,
    })
    .toBe("1");
}

/** 图片成功显示后，2:3 占位必须隐藏（P2：非 2:3 封面不应留下灰色衬底）。 */
export async function expectPlaceholderHidden(page: Page): Promise<void> {
  const placeholder = page.locator("[data-preview-cover-placeholder]");
  await expect(placeholder).toHaveCount(1);
  await expect
    .poll(async () => placeholder.evaluate((el: Element) => getComputedStyle(el).opacity), {
      timeout: 5_000,
    })
    .toBe("0");
}

/** 关闭后焦点应回到触发行。 */
export async function expectFocusOnTrigger(page: Page): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(() => document.activeElement?.hasAttribute("data-subject-trigger") ?? false),
    )
    .toBe(true);
}
