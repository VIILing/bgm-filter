import { expect, test } from "@playwright/test";

import {
  DIALOG,
  expectDialogClosed,
  expectFocusOnTrigger,
  JUMP,
  openDialog,
  OVERLAY,
  PANEL,
  ROW,
} from "./dialog-helpers";

const LAYOUTS = [
  {
    width: 1440,
    height: 900,
    panel: { x: 280, y: 40, width: 880, height: 820 },
    jump: { x: 1180, y: 40, width: 56, height: 56 },
    gap: 20,
  },
  {
    width: 1280,
    height: 900,
    panel: { x: 200, y: 40, width: 880, height: 820 },
    jump: { x: 1100, y: 40, width: 56, height: 56 },
    gap: 20,
  },
  {
    width: 1024,
    height: 900,
    panel: { x: 88, y: 40, width: 848, height: 820 },
    jump: { x: 952, y: 40, width: 56, height: 56 },
    gap: 16,
  },
  {
    width: 768,
    height: 900,
    panel: { x: 88, y: 40, width: 592, height: 820 },
    jump: { x: 696, y: 40, width: 56, height: 56 },
    gap: 16,
  },
];

for (const layout of LAYOUTS) {
  test(`${layout.width}×900：面板严格居中、BGM 按钮 56×56 且顶边对齐`, async ({ page }) => {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(ROW).first()).toBeVisible({ timeout: 30_000 });
    await openDialog(page, 0);

    const panel = await page.locator(PANEL).boundingBox();
    const jump = await page.locator(JUMP).boundingBox();
    expect(panel).not.toBeNull();
    expect(jump).not.toBeNull();

    expect(Math.round(panel!.x)).toBe(layout.panel.x);
    expect(Math.round(panel!.y)).toBe(layout.panel.y);
    expect(Math.round(panel!.width)).toBe(layout.panel.width);
    expect(Math.round(panel!.height)).toBe(layout.panel.height);
    expect(Math.round(jump!.x)).toBe(layout.jump.x);
    expect(Math.round(jump!.y)).toBe(layout.jump.y);
    expect(Math.round(jump!.width)).toBe(56);
    expect(Math.round(jump!.height)).toBe(56);
    expect(Math.round(jump!.y)).toBe(Math.round(panel!.y));
    expect(Math.round(jump!.x - (panel!.x + panel!.width))).toBe(layout.gap);

    // 遮罩覆盖全视口，层级：遮罩 100 < dialog 101 < 按钮 102。
    const layers = await page.evaluate(() => {
      const overlay = document.querySelector("[data-subject-dialog-overlay]") as HTMLElement;
      const dialog = document.querySelector("[data-subject-dialog]") as HTMLElement;
      const panel = document.querySelector("[data-subject-dialog-panel]") as HTMLElement;
      const jump = document.querySelector("[data-subject-dialog-jump]") as HTMLElement;
      const overlayRect = overlay.getBoundingClientRect();
      return {
        overlay: {
          x: overlayRect.x,
          y: overlayRect.y,
          w: overlayRect.width,
          h: overlayRect.height,
          z: getComputedStyle(overlay).zIndex,
          bg: getComputedStyle(overlay).backgroundColor,
          blur: getComputedStyle(overlay).backdropFilter,
        },
        dialogZ: getComputedStyle(dialog).zIndex,
        panelZ: getComputedStyle(panel).zIndex,
        jumpZ: getComputedStyle(jump).zIndex,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        htmlOverflow: document.documentElement.style.overflow,
        bodyOverflow: document.body.style.overflow,
      };
    });
    expect(layers.overlay.x).toBe(0);
    expect(layers.overlay.y).toBe(0);
    expect(layers.overlay.w).toBe(layout.width);
    expect(layers.overlay.h).toBe(layout.height);
    expect(layers.overlay.z).toBe("100");
    expect(layers.dialogZ).toBe("101");
    expect(layers.panelZ).toBe("101");
    expect(layers.jumpZ).toBe("102");
    expect(layers.overlay.bg).toBe("rgba(15, 23, 42, 0.22)");
    expect(layers.overlay.blur).toBe("blur(2px)");
    expect(layers.overflowX).toBe(0);
    expect(layers.htmlOverflow).toBe("hidden");
    expect(layers.bodyOverflow).toBe("hidden");
  });
}

test("关闭方式：遮罩 / Esc / 右键（阻止菜单）；点面板与按钮不关闭；按钮打开新标签", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(ROW).first()).toBeVisible({ timeout: 30_000 });

  // 点面板不关闭
  await openDialog(page, 0);
  await page.locator(PANEL).click({ position: { x: 80, y: 80 } });
  await expect(page.locator(DIALOG)).toBeVisible();

  // 点 BGM 按钮：新标签打开 bgm.tv，弹窗保持
  const popupPromise = page.waitForEvent("popup");
  await page.locator(JUMP).click();
  const popup = await popupPromise;
  expect(popup.url()).toContain("https://bgm.tv/subject/");
  await expect(page.locator(DIALOG)).toBeVisible();
  await popup.close();

  // 左键点遮罩空白关闭
  await page.mouse.click(20, 450);
  await expectDialogClosed(page);
  await expectFocusOnTrigger(page);

  // Esc 关闭
  await openDialog(page, 1);
  await page.keyboard.press("Escape");
  await expectDialogClosed(page);

  // 右键面板关闭，且浏览器菜单被阻止
  await openDialog(page, 1);
  const prevented = page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        document.addEventListener("contextmenu", (event) => resolve(event.defaultPrevented), {
          once: true,
          capture: true,
        });
      }),
  );
  const panelBox = await page.locator(PANEL).boundingBox();
  await page.mouse.click(
    panelBox!.x + panelBox!.width / 2,
    panelBox!.y + panelBox!.height / 2,
    { button: "right" },
  );
  expect(await prevented).toBe(true);
  await expectDialogClosed(page);
  await expectFocusOnTrigger(page);
});

test("滚动锁定：打开时页面不动、关闭后恢复滚动位置与焦点", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(ROW).first()).toBeVisible({ timeout: 30_000 });

  await page.evaluate(() => window.scrollTo(0, 300));
  await page.waitForTimeout(150);
  await openDialog(page, 2);
  const lockedY = await page.evaluate(() => window.scrollY);

  const beforeWheel = lockedY;
  await page.mouse.wheel(0, 800);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.scrollY)).toBe(beforeWheel);

  await page.keyboard.press("Escape");
  await expectDialogClosed(page);
  await expectFocusOnTrigger(page);
  expect(await page.evaluate(() => window.scrollY)).toBe(lockedY);
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
});

test("resize：≥768 重新居中；<768 关闭并解锁", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(ROW).first()).toBeVisible({ timeout: 30_000 });
  await openDialog(page, 0);

  const before = await page.locator(PANEL).boundingBox();
  expect(Math.round(before!.x)).toBe(88);
  expect(Math.round(before!.width)).toBe(848);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  const after = await page.locator(PANEL).boundingBox();
  expect(Math.round(after!.x)).toBe(280);
  expect(Math.round(after!.width)).toBe(880);
  await expect(page.locator(DIALOG)).toBeVisible();

  await page.setViewportSize({ width: 700, height: 900 });
  await expectDialogClosed(page);
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
});

test.describe("<768：不启用弹窗，点击直接新标签打开 bgm.tv", () => {
  test.use({ viewport: { width: 767, height: 900 } });

  test("点击行不出现弹窗", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const rows = page.locator(ROW);
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });

    const popupPromise = page.waitForEvent("popup");
    await rows.first().locator('a[href*="/subject/"]').first().click();
    const popup = await popupPromise;
    expect(popup.url()).toContain("https://bgm.tv/subject/");
    await expect(page.locator(DIALOG)).toHaveCount(0);
    await popup.close();
  });
});

test.describe("触屏（hover:none）：点击直接新标签打开 bgm.tv", () => {
  test.use({ viewport: { width: 1024, height: 900 }, hasTouch: true, isMobile: true });

  test("tap 不出现弹窗", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const rows = page.locator(ROW);
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(false);

    const popupPromise = page.waitForEvent("popup");
    await rows.first().locator('a[href*="/subject/"]').first().tap();
    const popup = await popupPromise;
    expect(popup.url()).toContain("https://bgm.tv/subject/");
    await expect(page.locator(DIALOG)).toHaveCount(0);
    await popup.close();
  });
});

test("打开动画：180/160/220ms、弹性曲线与起始 scale(0.92)", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(ROW).first()).toBeVisible({ timeout: 30_000 });
  await openDialog(page, 0);

  const styles = await page.evaluate(() => {
    const read = (selector: string) => {
      const el = document.querySelector(selector) as HTMLElement;
      const s = getComputedStyle(el);
      return {
        animationName: s.animationName,
        animationDuration: s.animationDuration,
        animationDelay: s.animationDelay,
        animationTimingFunction: s.animationTimingFunction,
        transform: s.transform,
        opacity: s.opacity,
      };
    };
    const panel = document.querySelector("[data-subject-dialog-panel]") as HTMLElement;
    const pop = panel
      .getAnimations()
      .find((animation) => (animation as CSSAnimation).animationName === "subject-dialog-pop-in");
    return {
      panel: read("[data-subject-dialog-panel]"),
      overlay: read("[data-subject-dialog-overlay]"),
      jump: read("[data-subject-dialog-jump]"),
      keyframes: pop
        ? (pop.effect as KeyframeEffect)
            .getKeyframes()
            .map((frame: Keyframe) => frame.transform ?? null)
        : null,
    };
  });

  expect(styles.panel.animationName).toBe("subject-dialog-pop-in, subject-dialog-fade-in");
  expect(styles.panel.animationDuration).toBe("0.22s, 0.16s");
  expect(styles.panel.animationTimingFunction).toBe(
    "cubic-bezier(0.34, 1.56, 0.64, 1), ease-out",
  );
  expect(styles.panel.transform).toBe("matrix(1, 0, 0, 1, 0, 0)");
  expect(styles.panel.opacity).toBe("1");
  expect(styles.keyframes).toEqual(["scale(0.92) translateY(6px)", "scale(1) translateY(0px)"]);

  expect(styles.overlay.animationName).toBe("subject-dialog-fade-in");
  expect(styles.overlay.animationDuration).toBe("0.18s");
  expect(styles.overlay.animationTimingFunction).toBe("ease-out");

  expect(styles.jump.animationName).toBe("subject-dialog-jump-in, subject-dialog-fade-in");
  expect(styles.jump.animationDuration).toBe("0.22s, 0.22s");
  expect(styles.jump.animationDelay).toBe("0.025s, 0.025s");
});

test.describe("prefers-reduced-motion：关闭缩放/位移/回弹", () => {
  test.use({ reducedMotion: "reduce" });

  test("面板无 transform/animation，关闭快速卸载", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(ROW).first()).toBeVisible({ timeout: 30_000 });
    await openDialog(page, 0);

    const styles = await page.evaluate(() => {
      const read = (selector: string) => {
        const s = getComputedStyle(document.querySelector(selector) as HTMLElement);
        return {
          animationName: s.animationName,
          transitionDuration: s.transitionDuration,
          transform: s.transform,
          opacity: s.opacity,
        };
      };
      return {
        panel: read("[data-subject-dialog-panel]"),
        overlay: read("[data-subject-dialog-overlay]"),
        jump: read("[data-subject-dialog-jump]"),
      };
    });

    expect(styles.panel.animationName).toBe("none");
    expect(styles.panel.transform).toBe("none");
    expect(styles.panel.opacity).toBe("1");
    expect(styles.panel.transitionDuration).toBe("0s");
    expect(styles.overlay.animationName).toBe("none");
    expect(styles.jump.animationName).toBe("none");
    expect(styles.jump.transform).toBe("none");

    await page.keyboard.press("Escape");
    await expect(page.locator(DIALOG)).toHaveCount(0, { timeout: 1_000 });
  });
});
