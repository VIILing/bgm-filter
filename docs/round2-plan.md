# BGM Filter · Round 2 执行计划（PM）

> 由 PM 统筹产出。上游依据：用户提出的 3 项新需求；实现细节待 4 角色 Agent 调研后汇入
> `docs/requirements.md` / `docs/architecture.md` 的增量章节。本文件负责「改什么、谁负责、什么顺序」。

## 1. 本轮需求

| # | 需求 | 说明 |
| --- | --- | --- |
| 1 | 端口 | 开发端口 8004，对外端口 9004（`~/port-list.txt` 已登记） |
| 2 | dump 可配置 | 不复制 dump 文件夹，用自定义配置直接读取共享目录 `/mnt/hgfs/bgm-filter/dump-db`（只读） |
| 3 | 简介懒加载 | `summary` 不再入库；改为随封面 API（`GET /v0/subjects/{id}`）一起懒加载 |

## 2. 团队与文件所有权（常设，从始至终）

| 角色 | 职责范围（独占） | 本轮承担 |
| --- | --- | --- |
| 后端 Agent | `prisma/schema.prisma`、`src/server/**`、`src/shared/subject-contract.ts`、服务端测试 | 需求 3 服务端（schema 去 summary、preview 懒加载、cover-cache 存 summary、bgm-client 取 summary） |
| 前端 Agent | `src/app/**`、`src/components/**`、`src/lib/**`、`src/trpc/**`（客户端） | 需求 3 前端（HoverPreview/CoverLoader 懒加载简介） |
| 数据 Agent | `scripts/**`、`docs/data-report.md`、dump 读取与导入 | 需求 2 全部；需求 3 导入侧（停写 summary） |
| QA Agent | `docs/qa-report.md`、测试/验收/回归（不擅改业务源码） | 需求 1/2/3 验收与回归 |
| PM（本人） | 需求澄清、`docs/`（requirements/architecture/plan）、派单与验收 | 统筹 + 文档 |

## 3. 协作规则

1. **依赖安装/`db:push`/`db:import` 等环境操作**：只由对应角色在约定阶段执行，并同步 PM。
2. **schema 变更顺序**：后端 Agent 改 schema → 数据 Agent 同步 import 脚本 → 后端 `db:generate` → `db:push` → 数据 `db:import`（读共享 dump）→ 后端/前端联调。
3. **契约单一来源**：`src/shared/subject-contract.ts` 由后端 Agent 维护；前端按契约实现，确需变更先报 PM。
4. **质量门禁**：`pnpm test` 全绿 + `pnpm typecheck` 0 error；涉及构建再 `pnpm build`。
5. **禁止**：把 summary 写回 `Subject` 表；dump/DB/`.cache`/`.env.local` 不入库；token 不进客户端；不随意 `pnpm add`。
6. **如实报告**：测不出来写「未验证」，不伪造结果。
7. **环境类操作须上报**：sudo/apt/系统库/挂载/网络代理等 Agent 无法自行完成的，一律上报 PM，由 PM 统一请用户处理；不得自行绕行（如反复重试、改环境绕过）。

## 4. 执行顺序（依赖驱动）

1. 【已完成】端口列表登记。
2. 【进行中】4 角色并行调研现状 → 各出报告。
3. PM 汇总调研 → 更新 `docs/requirements.md`（Round2 增量）与 `docs/architecture.md`。
4. 需求 3 服务端/数据侧先行（schema + import + cache + preview），需求 2 数据侧并入同一批改动。
5. 需求 3 前端侧（懒加载 UI）在后端接口就绪后实施。
6. QA 逐条验收（端口 / dump 可配置 / summary 懒加载）+ 回归全绿。

## 5. 里程碑

- M1：调研完成，需求/架构文档更新。
- M2：DB 重导（无 summary）+ 预览接口懒加载 + 前端联调可用。
- M3：QA 验收三改动 + 门禁全绿。
