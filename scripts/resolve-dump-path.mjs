import path from "node:path";

/**
 * 纯函数：解析 dump 数据目录（供 import-dump.mjs 使用，独立模块便于单测）。
 *
 * 规则（与 resolveDbPath 对 DATABASE_URL 的处理语义对称）：
 *  - envDir 为绝对路径 → 直接返回该路径；
 *  - envDir 为相对路径 → 相对 root（仓库根）解析；
 *  - envDir 为空/空白/未定义 → 回退默认 "dump-db"（相对 root）。
 * 不依赖当前工作目录（cwd），避免相对路径随运行目录漂移。
 *
 * @param {string|undefined} envDir 环境变量 DUMP_DIR 的取值
 * @param {string} root 仓库根绝对路径
 * @returns {string} dump 目录绝对路径
 */
export function resolveDumpPath(envDir, root) {
  const dir = typeof envDir === "string" && envDir.trim() !== "" ? envDir.trim() : "dump-db";
  return path.resolve(root, dir);
}
