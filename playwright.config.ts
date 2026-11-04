import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig } from "@playwright/test";

/**
 * 运行期临时目录（供 dev server / 测试进程的 SQLite 使用）。
 *
 * 背景：`subject.search` 的加权排序（700k 条 `ORDER BY weighted` + 大 `OFFSET`）与
 * `!R18` 取反（`EXCEPT` 全表）需要 SQLite 临时文件；本沙箱在**未设 `TMPDIR`** 时
 * 会拦截临时目录写 → `unable to open database file`。因此这里统一把 TMPDIR 指到
 * 仓库内 `.tmp/`（已 gitignore），并随 `webServer.env` 传给 `pnpm dev`。
 *
 * 运行时可用 `TMPDIR=$PWD/.tmp pnpm test:e2e` 显式指定；缺省则回退仓库根 `.tmp`。
 */
const tmpDir = process.env.TMPDIR ?? resolve(process.cwd(), ".tmp");
mkdirSync(tmpDir, { recursive: true });

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8004",
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:8004",
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      ...process.env,
      TMPDIR: tmpDir,
      SQLITE_TMPDIR: tmpDir,
    },
  },
});
