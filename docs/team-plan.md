# BGM Filter · 团队执行计划与数据基线（Lead）

> 由 Lead 在 S0 阶段产出。上游依据：`docs/requirements.md`（需求唯一依据）、`docs/architecture.md`（实现契约）、`docs/rebuild-plan.md`（执行顺序）。
> 本文件只补充「实测环境/数据基线」与「团队分工/文件所有权」，三者冲突时以 requirements + architecture 为准。

## 1. 环境自检（2026-11-03，已通过）

| 项 | 实测 | 结论 |
| --- | --- | --- |
| 工作目录 | `/home/ubuntu/bgm-filter` | ✅ |
| Node | v27.0.0-alpha.0.0.0 | ⚠️ 非 LTS，但可用；如遇 Next 15 兼容问题，降级到 v22 再试并记录 |
| pnpm | 12.16.1 | ✅（注意 pnpm 10+ 的 build scripts 默认拦截，需 `onlyBuiltDependencies`） |
| git | 2.43.0 | ✅ |
| CPU / RAM / 磁盘 | 4 core / 15 GB / 剩余 41 GB | ✅（dump 1.9 GB + DB ~0.5 GB + node_modules ~1 GB 足够） |
| registry | `https://mirrors.tencentyun.com/npm/`（可访问） | ✅ |
| Prisma 引擎源 | `binaries.prisma.sh` 可达 | ✅ |
| dump 解压 | `dump-db/` 9 个 jsonlines；`subject.jsonlines` = 993,732,536 B | ✅ |
| 沙箱 | 全权限（danger-full-access），无审批弹窗 | ✅ |

运行环境为 **Linux**（非 requirements 里假设的 Windows）。因此：命令用 `pnpm` 而非 `pnpm.cmd`，路径用正斜杠，`.ps1` 执行策略等 Windows 注意事项不适用；其余约束照旧。

## 2. 数据基线（对 `subject.jsonlines` 全量扫描核验）

与 `requirements.md` §2 一致，另补充实测：

| 指标 | 实测 | 与文档 |
| --- | --- | --- |
| 行数 / 坏行 | 700,108 / 0 | 一致 |
| 类型分布 | 1:422,971　2:31,258　3:101,230　4:117,881　6:26,768 | 一致 |
| 有 `tags` / `meta_tags` / 两者皆无 | 348,536 / 235,232 / 277,196 | 一致 |
| 有标签（并集） | 422,912 | 一致 |
| `score > 0` / `rank > 0` / `nsfw` | 287,448 / 43,604 / 50,838 | 一致 |
| `date` 为空 / `name_cn` 为空 | 53,871 / 552,686 | 一致 |
| 年份范围 | 701 – 2069（存在 `0701` 类脏数据与 <1900/>2032 异常） | 一致 |
| 标签去重（lowercase） | 91,909（大小写变体 914 组） | 文档 92,878 为按原始写法计数，量级一致 |
| 含空白 / 含 DSL 元字符的标签出现次数 | 42 / 3,421（如 `樱庭统!`、`|Otome|`、`~`） | 量级一致；**确认 DSL 必须支持引号包裹，标签名可包含 `& | ( ) ! ~` 全部元字符** |

**结论**：`requirements.md` 的数据事实可信，无需修改需求；导入脚本与 DSL 设计可直接按文档实现。

## 3. 团队与文件所有权（避免并行写冲突）

| 阶段 | 角色 | 负责文件（独占） | 禁止触碰 |
| --- | --- | --- | --- |
| S1 | scaffolder | 工程根文件（package.json/tsconfig/next.config/postcss/.env/.gitignore/.npmrc）、`prisma/schema.prisma`、`src/server/{db,api/trpc,api/root}.ts`、`src/app/{layout,globals.css,providers,page}.tsx`、`src/app/api/trpc/**`、`src/trpc/**`、`src/shared/subject-contract.ts` | `scripts/**`、`src/server/tag-dsl/**`、`src/server/search/**`、`src/components/**`、`src/lib/**` |
| S2 | data-engineer | `scripts/**`、`docs/data-report.md` | 其余全部（只读 schema） |
| S3 | api-engineer | `src/server/tag-dsl/**`、`src/server/search/**`、`src/server/api/routers/**`、`src/shared/subject-contract.ts`（仅经 Lead 允许的增量）、`src/**/*.test.ts`（服务端） | 前端文件、`scripts/**`、根配置 |
| S4 | ui-engineer | `src/app/page.tsx`、`src/components/**`、`src/lib/**`、`src/trpc/react.tsx`（如需调整） | 服务端文件、`scripts/**`、根配置 |
| S5 | qa-engineer | `docs/qa-report.md`、临时验证脚本（用完删除） | 业务源码（发现问题只报告 + 给最小复现，不擅自改） |
| S6 | Lead | `docs/team-plan.md`、`README.md` 终审、验收复核 | — |

## 4. 协作规则

1. **依赖安装只在 S1 做**。S2–S4 不得执行 `pnpm add` / `pnpm install`；缺依赖向 Lead 报告，由 Lead 决策。
2. **端口**：仅 S5 可启动 `pnpm dev`（3000/3001）；其他角色用 `vitest` / `tsc --noEmit` / 直接 node 脚本验证。
3. **契约单一来源**：`src/shared/subject-contract.ts` 由 S1 建立，S3/S4 必须按它实现；确需变更先报告 Lead。
4. **SQL 安全**：标签名只走参数化，禁止拼接用户输入；DSL 编译输出 `{sql, params}`。
5. **完成标准**：每个角色提交「改了什么 + 验证命令与结果 + 已知风险」三句话，不贴大段代码。
6. 遇到无法解决的问题：立即报告 Lead，不要绕过或伪造（尤其不要伪造数据/测试通过）。

## 5. 里程碑

- M1（S1）：`pnpm dev` 可启动，占位页 200，`prisma generate` + `db push` 成功。
- M2（S2/S3/S4 并行）：DB 导入完成且计数吻合；DSL 单测绿；页面可筛选。
- M3（S5）：`typecheck` / `test` / `build` 全绿 + 验收清单逐条证据。
- M4（S6）：Lead 复核 + 交付说明。
