import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * 服务端单测：node 环境，`~/` → `src/`。
 *
 * `test.env.DATABASE_URL` 让直接 import `~/server/db` 的模块（router）在构造
 * PrismaClient 时就有合法 URL；具体测试用例用 `datasourceUrl` 指向各自的临时
 * SQLite fixture，绝不写 `prisma/dev.db`。
 */
export default defineConfig({
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      DATABASE_URL: `file:${fileURLToPath(new URL("./prisma/dev.db", import.meta.url))}`,
    },
    // Prisma 首次连接临时 SQLite 文件偶尔偏慢，放宽单测超时。
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
