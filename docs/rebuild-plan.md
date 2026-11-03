# 云端全权限环境 · 重做执行计划（Rebuild Runbook）

> 触发前提：运行环境已迁移到云端，且本会话具备 **全权限（不启用 DSH 沙箱）**。
> 目标：**只保留 `docs/` + `dump-db/`（+ `dump-format.md`）**，其余全部推倒重来，严格按 `docs/requirements.md` 与 `docs/architecture.md` 交付。
> 本文档是重做时的执行清单，配合共享任务板使用。

## 0. 迁移后环境自检（第一件事，全部通过才开工）

```bash
# 1) 基础工具
node -v          # 期望 >= 20.18，推荐 22.x
pnpm -v          # 期望 9.x / 10.x
git --version

# 2) 确认不是受限沙箱（关键）
node -e "const{spawnSync}=require('child_process');const r=spawnSync('node',['-v'],{encoding:'utf8'});console.log(r.error?('BLOCKED '+r.error.code):('OK '+r.stdout.trim()))"
# 期望输出 OK v22.x；若为 BLOCKED EPERM，说明仍是沙箱，需要切换为完全权限

# 3) 工作区内容
ls            # 期望只有 docs/ dump-db/ dump-format.md
ls -la dump-db   # 期望 9 个 jsonlines，subject.jsonlines ≈ 993 MB / 700,108 行

# 4) 网络与磁盘
pnpm view next version      # 期望能访问 registry（默认 npmmirror）
df -h .                     # 期望剩余 >= 3 GB（dump 1.8 GB + DB ~0.5 GB + node_modules ~1 GB）
```

任一项不满足：先报告 Lead，不要硬做。

## 1. 阶段划分与智能体分工

| 阶段 | 负责人 | 产出 | 依赖 |
| --- | --- | --- | --- |
| S0 环境准备 | Lead | 自检报告、git init、任务板（T1–T5）、契约确认 | 用户通知环境就绪 |
| S1 脚手架 | scaffolder | T3 Stack 工程、依赖、Prisma schema、`prisma generate`、`prisma db push`、tRPC 基座、契约文件、占位页可启动 | S0 |
| S2 数据导入 | data-engineer | `scripts/import-dump.mjs` + 执行导入 + `docs/data-report.md`（计数/耗时/体积） | S1 |
| S3 服务端 | api-engineer | 标签 DSL parser/compiler、查询构造、tRPC subject 路由、vitest 单测、性能数据 | S1（schema）、S2（真实数据验证） |
| S4 前端 | ui-engineer | 单页筛选 UI、URL 状态、结果/分页/空态/错误态、url-state 单测 | S1（契约/基座） |
| S5 QA | qa-engineer | 全链路验收（install/import/typecheck/test/build/dev/HTTP 接口）、`docs/qa-report.md` | S2+S3+S4 |
| S6 终审 | Lead | 验收清单逐条复核、diff 审查、最终交付说明与本地使用方式 | S5 |

并行策略：S1 完成后，**S2、S3、S4 并行**（写文件范围互斥）；S3 先用小 fixture 完成单测，待 S2 完成后跑真实数据验证；S5 统一验收。

## 2. 重装命令（Linux / macOS；Windows 用 `pnpm.cmd` 并去掉 `bash` 语法）

```bash
# 1) 初始化工程（scaffolder 手工写文件，不跑交互式 create-t3-app）
#    package.json 先写 scripts + pnpm.onlyBuiltDependencies，再安装
pnpm add next@15 react@19 react-dom@19 @trpc/server@11 @trpc/client@11 @trpc/react-query@11 \
  @tanstack/react-query@5 superjson@2 zod@3 @prisma/client@6
pnpm add -D typescript@5 @types/node@22 @types/react@19 @types/react-dom@19 prisma@6 \
  tailwindcss@4 @tailwindcss/postcss@4 postcss@8 vitest@3

# 2) Prisma：schema 按 architecture.md §4 原样；.env: DATABASE_URL="file:./dev.db"
pnpm exec prisma generate
pnpm exec prisma db push          # 全权限下应正常（受限沙箱下会被 spawn EPERM 拦住）

# 3) 数据导入（S2）
pnpm db:import                    # 从 dump-db/subject.jsonlines → prisma/dev.db

# 4) 质量门禁
pnpm typecheck && pnpm test && pnpm build

# 5) 启动（默认 3000；被占用则 3001）
pnpm dev
```

**测试框架**：全权限下用回 `vitest`（architecture.md §2 已约定），不要用受限沙箱时期的 node:test 变通方案。
**pnpm 布局**：全权限下用默认 isolated 布局，不需要 `--ignore-scripts` / hoisted 等任何绕过参数。
**仓库**：`git init` + `.gitignore`（`dump-db/`、`node_modules/`、`.next/`、`prisma/*.db`、`*.log`），初始 commit 只含工程文件；dump 数据不入库。

## 3. 数据验收基线（导入后必须吻合）

| 项 | 期望值 | 说明 |
| --- | --- | --- |
| Subject 总数 | 700,108 | `SELECT COUNT(*) FROM Subject` |
| 按类型 | 1: 422,971 / 2: 31,258 / 3: 101,230 / 4: 117,881 / 6: 26,768 | 与 dump 一致 |
| Tag 去重数 | ≈ 92,878 | tags ∪ meta_tags，按 `nameLower` 去重 |
| SubjectTag 关联数 | > 4,000,000（待导入实测记录） | 覆盖 422,912 个有标签条目 |
| 有评分条目 | 287,448（41.0%） | score > 0 |
| 导入耗时 | ≤ 5 分钟 | 超时需优化批量/事务/PRAGMA |
| DB 体积 | ≤ 600 MB | `prisma/dev.db` |

## 4. 验收方式（全自动）

- S5 启动 `pnpm dev`（后台任务），对 `http://127.0.0.1:3000`：
  - 页面 GET 200，HTML 含标题/筛选控件骨架；
  - tRPC 查询端点直连验证（GET `/api/trpc/subject.search?input=...`），覆盖 requirements.md §6 第 2–11 条；
  - 与 SQLite 直查交叉校验 ≥3 组计数；
  - `pnpm build` 通过、`pnpm test` 全绿、`pnpm typecheck` 通过；
  - 汇总为 `docs/qa-report.md`（逐条验收表 + 证据 + 性能数据 + 已知问题）。
- S6 Lead 复核全部验收项，并给出最终页面 URL、启动/导入命令、验收报告链接。

## 5. 已知风险与规避

| 风险 | 规避 |
| --- | --- |
| 云端无 dump-db / 文件不全 | S0 自检；缺文件先报告用户补传，不要伪造数据 |
| registry 访问失败 | 切换 `https://registry.npmmirror.com/` 或官方源；prisma 引擎下载失败则重试/换镜像 |
| 端口占用 | dev 用 `-p 3001` 或 `PORT=3001`，最终 URL 写清楚 |
| Windows 路径 | `DATABASE_URL="file:./dev.db"` 相对 `prisma/`；跨平台统一用正斜杠 |
| 导入内存占用 | 逐行流式解析（readline/流式），不要 `readFileSync` 整个 993 MB |
| 标签特殊字符 | DSL 仅参数化 `nameLower`，禁止拼 SQL；前端插入自动加引号/转义 |
| Next 15 Suspense | 使用 `useSearchParams` 的客户端组件用 `<Suspense>` 包裹 |
| 大 OFFSET | 页码夹取到 `totalPages` |

## 6. 用户需要提供的

1. 云端工作区绝对路径（确认工作目录）；
2. 确认 `dump-db/` 已完整上传（9 个文件，`subject.jsonlines` 993 MB）；
3. 确认本会话已切到 **完全权限**（等价于：`node -e spawn` 探测通过、`pnpm install` 不再 EPERM）；
4. 确认端口 3000/3001 可用。

准备好后用户只需回复「环境就绪」，Lead 即启动 S0 自检并组建团队执行。
