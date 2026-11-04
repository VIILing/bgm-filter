# BGM Filter · Round 2 需求与设计规格（PM 汇总定稿）

> 依据：4 角色 Agent 调研报告（后端/数据/前端/QA，均只读）。本文件是 Round 2 的**唯一实现依据**，
> 与 `docs/requirements.md`（V1 需求）、`docs/architecture.md`（V1 实现）不冲突的部分继续沿用；
> 冲突处以本文件为准。执行顺序见 `docs/round2-plan.md`。

## 0. 环境事实与处置

| 项 | 状态 | 处置 |
| --- | --- | --- |
| 工作区 | `/home/viiling/bgm-filter`，git `main` @ `34c3942`，工作区干净 | — |
| node_modules / Prisma Client / dev.db | **均不存在**（全新环境） | 后端 Agent 先 `pnpm install` |
| `/mnt/hgfs/bgm-filter/dump-db` | **当前未挂载（空挂载点）** | 宿主机侧恢复挂载后才能 `db:import`/集成验证；代码改动不受阻 |
| `~/port-list.txt` | 已登记 `localhost:8004`（开发）、`0.0.0.0:9004`（对外） | ✅ 已完成（PM） |

> 阻塞项：`db:push` + `db:import`（重导去 summary 的 DB）与真实数据集成/E2E 验证依赖共享 dump，
> 在挂载恢复前**只能**做代码改动 + `pnpm install` + `pnpm db:generate` + `pnpm typecheck` + 纯单元测试。

## 1. 需求与验收标准

### 1.1 端口（8004 开发 / 9004 对外）
- `package.json`：`dev` 脚本改为 `next dev -p 8004`；对外用 `pnpm exec next dev -H 0.0.0.0 -p 9004`。
- 文档（README / AGENTS）中旧端口 3000 / 3001 / 7737 引用同步为 8004 / 9004。
- 验收：`ss -ltnp` 8004 绑回环、9004 绑 0.0.0.0；`curl` 各自 200。

### 1.2 dump 可配置（直读共享目录、不复制）
- `scripts/import-dump.mjs`：`DUMP_DIR` 解析基准从 `process.cwd()` 改为仓库根 `ROOT`，即
  `path.resolve(ROOT, process.env.DUMP_DIR ?? "dump-db")`（绝对路径直接生效、相对路径相对 ROOT）。
- 脚本**显式读取 `.env.local`**（`.env.local` 优先于 `.env`；`existsSync` + `readFileSync` 手动解析
  `DUMP_DIR=...` 并赋值，零依赖），因为 `pnpm db:import` 当前只 `--env-file=.env`。
- `.env.template` / README / AGENTS 文档化：`DUMP_DIR="/mnt/hgfs/bgm-filter/dump-db"` 用法。
- **不复制**：脚本对 dump 只有 `createReadStream/existsSync/statSync`（只读），禁止出现任何
  copy/cp/rename 调用；`VACUUM`/WAL 写的是 `prisma/dev.db`，与 dump 无冲突。
- 验收：设 `DUMP_DIR` 指向共享目录后 `db:import` 直读成功、仓库内无 `dump-db/` 副本、
  `docs/data-report.md` 数据源行指向共享目录。

### 1.3 简介不再入库，随封面 API 懒加载
- `Subject.summary` 列移除；`import-dump.mjs` 停写 summary。
- 简介通过 `GET /v0/subjects/{id}`（与封面同一次请求）懒加载，并缓存到 `.cache/covers.db`。
- 验收：`PRAGMA table_info("Subject")` 无 summary；`db:import` 无 summary 相关输出；DB 体积回落；
  预览接口暖缓存秒回 summary、冷缓存回源一次后命中、404/空 → summary=null 且 tags 仍返回。

## 2. 设计定稿（消歧）

### 2.1 预览拆接口（采纳前端方案，复用后端缓存管道）
- `subject.preview({id})` → `{ id, tags: SubjectPreviewTag[], metaTags: string[] }`
  （**本地 DB**，毫秒级；不再返回 summary）。
- 新增 `subject.summary({id})` → `{ id, summary: string | null }`
  （**懒加载**：先查 cover_cache，未命中则 `getSubject` 回源；**永不抛错**，404/网络/熔断/空 → `summary:null`）。
- 契约（`src/shared/subject-contract.ts`）：
  - `SubjectPreviewDto` **删除** `summary` 字段；
  - 新增 `SubjectSummaryDto { id: number; summary: string | null }`。

### 2.2 缓存 v4（summary 与封面同源共缓存）
- `cover_cache` 表新增两列：`summary TEXT`、`summaryFetched INTEGER NOT NULL DEFAULT 0`。
- `PRAGMA user_version` 3 → 4。
- `summaryFetched` 用于区分「未知（从未取到，0）」与「确定无简介（已取到但为空/404，1）」，
  避免空简介条目反复回源。
- `getCovers` 取封面时**顺带** `pickSummary(subject)` 并一起落缓存（封面加载即预热 summary）；
  `subject.summary` 走新增 `getSummary(id)`，多数命中缓存、0 外呼。
- 404 时：`summary=NULL` 且 `summaryFetched=1`，URL 照常写负缓存。
- **迁移必须分版本重构**：现有 `migrate()` 是「version<当前 → 清空负缓存」的硬编码 v3 逻辑，
  直接 bump 到 4 会误清 v3 有效负缓存；改为按版本逐级迁移，v3→v4 仅加列、**不清负缓存**，
  并新增「v3→v4 不清负缓存」用例。
- `BgmSubject` 增加 `summary?: string | null`（**可选**，避免破坏现有 fake 的类型）。

### 2.3 前端（HoverPreview）
- 拆两个 `useQuery`：`subject.preview`（tags，快）+ `subject.summary`（简介，慢）；均 `staleTime 5min`。
- 三态独立：tags 区骨架 / summary 区骨架「正在加载简介…」→ 有值渲染 / null→「暂无简介」。
- summary 接口 `retry:false`，失败与空统一「暂无简介」，面板其余照常。
- 复用后端同源缓存；**不复用** CoverLoader 组件（其整页批次机制不适合单条 hover）。

## 3. 文件所有权（常设）

| 角色 | 独占文件 |
| --- | --- |
| 后端 Agent | `prisma/schema.prisma`、`src/server/**`、`src/shared/subject-contract.ts`、`src/**/*.test.ts`（服务端）、`package.json`（dev/start 脚本） |
| 数据 Agent | `scripts/**`、`docs/data-report.md`、`.env.template`（DUMP_DIR 段） |
| 前端 Agent | `src/app/**`、`src/components/**`、`src/lib/**`、`src/trpc/**` |
| QA Agent | `docs/qa-report.md`、验收/回归执行（不擅改业务源码与实现单测） |
| PM | `docs/round2-*.md`、`docs/requirements.md`/`docs/architecture.md` 增量、`~/port-list.txt` |

> 新单元测试由**实现方**写入自己独占的测试文件（后端写 cover-cache/cover-service/bgm-client/preview 测试、
> 数据抽 `resolveDumpPath` 纯函数并测）；QA 只负责门禁执行、E2E 验收与报告，发现问题给复现不改源码。

## 4. 依赖顺序

1. 后端：`pnpm install` → schema 去 summary + `db:generate` → contract 改 → bgm-client/cover-cache/cover-service
   → preview 拆接口 → 服务端单测 → `typecheck`+单测。
2. 数据：Task2 DUMP_DIR + .env.local + 停写 summary（与后端代码无文件冲突，可并行）。
3. 前端：待后端 contract 定稿后改 HoverPreview。
4. QA：挂载恢复后 `db:push`+`db:import`+门禁三连+E2E；挂载未恢复则先跑 typecheck/单测并记录「未验证」。

## 5. 质量门禁

- `pnpm test` 全绿（原 171 项 + 新增）；`pnpm typecheck` 0 error；涉及 schema 变更必须补 `pnpm build`。
- 集成测试 `subject-search.integration.test.ts`：移除 summary 后 **0 断言需改**，仅需重导同一份 dump 后跑真库；
  建议新增一条只读断言 `PRAGMA table_info("Subject")` 不含 `summary`（用 `node:sqlite`，勿用 Prisma）。
- 真实数据验证：DB 重导后三表计数仍为 700,108 / 91,909 / 2,267,357。
