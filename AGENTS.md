# AGENTS.md · 主 Agent 交接手册

> 本文件面向接手本项目的下一位 Agent（或未来的自己）。目标：**读完这一份就能在全新环境里跑起来、改得动、验得准**。
> 需求与实现细节以 `docs/requirements.md`、`docs/architecture.md` 为准；本文件负责「怎么上手、怎么避坑、现在到哪了」。

---

## 1. 项目一句话

本地运行的 Bangumi 条目筛选工具：把 [bangumi/Archive](https://github.com/bangumi/Archive) 全量条目 dump（70 万条）导入本地 SQLite，在网页上按「标签表达式 + 年代 + 类型 + 名称」筛选、按贝叶斯加权评分排序，卡片带封面与点击预览弹窗。纯本地、无登录、除封面/预览外不访问外部服务。

**技术栈**：T3 Stack —— Next.js 15（App Router）+ React 19 + TypeScript + tRPC 11 + Prisma 6（SQLite）+ Tailwind CSS 4；Vitest 3；pnpm。

**当前状态**：功能完整；207 项 Vitest + 17 条 Playwright E2E 全绿，`typecheck` 0 error，`build` 通过。条目预览已改为 Round 4 的「点击居中弹窗」（V3，见 §6.5），悬浮预览停用，打开带弹性 pop 动效；UI 仍有少量待打磨项（见 §9）。

---

## 2. 环境要求与首次启动

### 2.1 环境

| 项 | 要求 | 本项目实测 |
| --- | --- | --- |
| Node | **≥ 22.5**（推荐 22.13+ / 24 LTS） | v27.0.0-alpha（可运行） |
| pnpm | **12.x**（`allowBuilds` 语义） | 12.16.1 |
| 磁盘 | ≥ 4 GB 空闲（dump 1.9 GB + DB 约 0.4 GB + node_modules ~700 MB） | 41 GB 可用 |
| 网络 | 安装依赖、首次下载 dump、取封面时需要 | 已通 |

### 2.2 启动步骤（全新机器）

```bash
git clone https://github.com/VIILing/bgm-filter.git
cd bgm-filter
pnpm install

# 1) 生成 Prisma Client 并建表
pnpm db:generate
pnpm db:push

# 2) 准备 dump（任选其一；至少需要 subject.jsonlines，993 MB / 700,108 行）
#    方式 A（推荐，不下载不复制）：直读共享目录
#      echo 'DUMP_DIR="/mnt/hgfs/bgm-filter/dump-db"' >> .env.local
#    方式 B（本地下载，约 449 MB zip → 解压约 1.9 GB）
#      下载地址见 docs/db-download-url.txt（或 https://github.com/bangumi/Archive/releases/tag/archive）
#      mkdir -p dump-db && cd dump-db
#      curl -L -o dump.zip "https://github.com/bangumi/Archive/releases/download/archive/dump-2026-10-27.210404Z.zip"
#      unzip -o dump.zip && cd ..

# 3) 导入（约 27–31 s，生成 prisma/dev.db；summary 不再入库）
pnpm db:import

# 4) 启动
pnpm dev                      # http://localhost:8004
# 需要局域网/远程访问时：
pnpm exec next dev -H 0.0.0.0 -p 9004
```

### 2.3 环境变量

| 变量 | 文件 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | `.env`（已提交） | `file:./dev.db`，相对 `prisma/` |
| `BGM_API_TOKEN` | `.env.local`（**绝不提交**） | Bangumi 个人令牌；不配则 NSFW 条目封面 404 |
| `DUMP_DIR` | `.env.local`（推荐）或环境变量 | 覆盖 dump 目录：绝对路径直接生效、相对路径相对仓库根、默认 `dump-db`；`.env.local` 优先 |

模板见 `.env.template`。改完 `.env.local` **必须重启 dev** 才生效。

> **Node 必须 ≥ 22.5**：`scripts/import-dump.mjs`、`scripts/verify-db.mjs` 与测试都依赖内置 `node:sqlite`，Node 20 会直接 `ERR_UNKNOWN_BUILTIN_MODULE`。
> **`pnpm db:import` 会重写 `docs/data-report.md`**（写入当次时间戳与本机绝对路径），这是预期产物变更，`git status` 出现它被修改不代表工作区被弄坏。

---

## 3. 关键约束（违反会出事故）

1. **`dump-db/`、`prisma/*.db`、`.cache/`、`.env.local` 绝不入库**（`.gitignore` 已覆盖）。dump 约 1.9 GB（summary 不再入库，DB 体积显著回落）。
2. **封面字段不能加到 `Subject` 表**：`scripts/import-dump.mjs` 每次导入会 `DELETE FROM "Subject"`，封面 URL 存在独立的 `.cache/covers.db`。
3. **所有 Bangumi 请求必须走 `src/server/bgm/bgm-client.ts`**，不要在业务代码里直接 `fetch`、读 token、拼 `Authorization` 或各建限速器。
4. **token 不得出现在客户端**：不要放在 `NEXT_PUBLIC_*`、不要 `console.log`、不要写进报告/截图/提交信息。
5. **DSL 标签名只参数化传入 SQL**，禁止字符串拼接用户输入。
6. **改动 schema 后**：`pnpm db:generate`（必要时 `db:push`），并**重启 dev**，否则运行中的进程仍持有旧 Prisma Client（会报 `Unknown field`）。
7. **不要随意 `pnpm add`**：项目刻意保持最小依赖（无 UI 库、无 jsdom/Playwright 到 `node_modules`）。确实需要时先与用户确认。
8. pnpm 12 起 `package.json` 的 `pnpm.onlyBuiltDependencies` 不再生效，构建白名单在 `pnpm-workspace.yaml` 的 `allowBuilds`；**不要删该文件**。

---

## 4. 目录与模块职责

```
src/
├─ app/                     # 单页 + /api/trpc/[trpc] route handler
├─ components/              # HomeClient（状态编排）、FilterPanel、TagExprInput、TypeFilter、
│                           # ResultList、SubjectCard、SubjectDialog、CoverLoader、Pagination、
│                           # SkeletonRows、EmptyState、ErrorState、Header、SortControls…
├─ lib/                     # 纯函数：url-state、tag-insert、tag-parse-lite、format、cover-batch（+单测）
├─ server/
│  ├─ db.ts                 # PrismaClient 单例
│  ├─ api/                  # trpc 初始化、root router、subject router、preview-utils
│  ├─ tag-dsl/              # parser（词法+递归下降）、compiler（AST→SQL）（+单测）
│  ├─ search/               # subject-search：WHERE/ORDER BY/分页/DTO（+真实数据集成测试）
│  ├─ bgm/bgm-client.ts     # 所有 Bangumi HTTP：UA/token/限速/重试/熔断/错误模型
│  └─ cover/                # cover-service（注入 BgmClient）、cover-cache（.cache/covers.db）
└─ shared/subject-contract.ts # 前后端唯一契约（zod schema + DTO 类型）
scripts/import-dump.mjs     # JSONL → SQLite（两遍扫描、幂等）
scripts/verify-db.mjs       # 计数/完整性/性能校验，生成 docs/data-report.md 的实测区块
docs/                       # 需求、架构、UI 设计、数据报告、QA 报告、封面调研
```

数据流：`URL query → parseFilterState → trpc.subject.search → subject-search → SQLite`；封面：`subject.covers → cover-service（缓存优先）→ BgmClient → api.bgm.tv`，图片由浏览器直连 `lain.bgm.tv`。

---

## 5. 数据模型与导入

```prisma
Subject(id, type, name, nameCn, date, year, score, scoreVotes, rank,
        nsfw, favoriteJson, tagsJson, metaTagsJson)
Tag(id, name, nameLower @unique, count)
SubjectTag(subjectId, tagId)   // 复合主键 + @@index([tagId, subjectId])
```

- 类型：1 漫画 / 2 动画 / 3 音乐 / 4 游戏 / 6 三次元。
- `tagsJson`：`[{"name":"井上雄彦","count":575}, …]`（count = 该标签在该条目上的使用人数）；`metaTagsJson`：`string[]`（无计数）。
- 简介（summary）**不再入库**：随封面 API（`GET /v0/subjects/{id}`）懒加载，与封面 URL 一起缓存到 `.cache/covers.db` 的 `summary` 列。
- `score = 0` 表示无评分；`year` 取 `date` 前 4 位数字（`0701` 会变 701，属预期脏数据）。

**导入规则**：两遍扫描（第一遍统计标签写法与条目数，第二遍写入）、每 2000 条一事务、`WAL + synchronous=OFF + foreign_keys=OFF`、结束 `ANALYZE`。幂等：导入前清空三表。当前基线：

| 项 | 值 |
| --- | --- |
| Subject / Tag / SubjectTag | 700,108 / 91,909 / 2,267,357 |
| 有评分 / 无日期 | 287,448 / 53,871 |
| 导入耗时 / DB 体积 | 约 27–31 s（summary 不再入库，体积回落） |

> `docs/requirements.md` 早期预估「约 500 万标签关联」有误，实测 2,267,357；详见 `docs/data-report.md`。

---

## 6. 关键实现说明（改之前先读）

### 6.1 标签 DSL
语法：`expr := or`，`or := and ("|" and)*`，`and := unary ("&" unary)*`，`unary := ("!"|"~") unary | primary`，`primary := "(" expr ")" | tag`。标签名含空白或 `& | ( ) ! ~ "` 时必须双引号包裹。
编译为 subjectId 集合子查询：tag → JOIN；AND → INTERSECT；OR → UNION；NOT → `EXCEPT` 全表；全部参数化。
前端 `src/lib/tag-parse-lite.ts` 是**独立**的轻量校验器（只做语法提示，不求值），与服务端 parser 需保持行为一致。

### 6.2 排序：贝叶斯加权（默认）
```
weighted = (score * scoreVotes + C * m) / (scoreVotes + m)
C = Σ(score*votes)/Σ(votes)（动态查询，约 7.104），m = 50
```
排序键：`(score=0) 分组 → weighted DESC → score DESC → id ASC`。`sort` 取值 `weighted_desc`（默认，URL 省略）/ `score_desc` / `score_asc`。
`C` 以 `WeakMap<PrismaClient, Promise<number>>` 进程内缓存；**重导 dump 后需重启**才会更新。

### 6.3 封面
- URL 含随机 hash，必须逐条调 `GET /v0/subjects/{id}`；无批量接口，官方限流 3000 次/10min/IP，超限封 1 小时。
- 只缓存 URL 与简介到 `.cache/covers.db`（`id, grid, small, common, large, summary, summaryFetched, fetchedAt, missing, reason`，`PRAGMA user_version=5`）；正缓存永久，`not_found` 1 天、`no_image` 7 天。v4 及更旧库启动时只加列、不重建；旧行缺 `large` 时读取层从 `common → small → grid` 去掉 `/r/<数字>/` 推导原图，用户无需清缓存。
- 前端每 10 个一块、链式请求（`CoverLoader`），文字先渲染，封面渐进填充；冷启动首图约 2.8 s、整页约 12 s，暖缓存 <1.2 s。列表只用 `/r/200` 小图；**原图 `large` 只在点击预览弹窗时加载**（实测 120–560 KB），暖缓存/重复打开走浏览器缓存，不再下载。
- `large` 是无 `/r/` 的原图路径且不带 CORS，只能用 `<img>`，禁止 fetch/canvas。
- NSFW 门禁已移除，但**匿名 API 对 NSFW 返回 404**；配 `BGM_API_TOKEN` 后可正常取图。

### 6.4 BgmClient
`src/server/bgm/bgm-client.ts` 是唯一出口：UA、Bearer token（`BGM_API_TOKEN`，构造时快照）、5 s 超时、令牌桶 4 req/s + 突发 4、并发 5、瞬时错误重试 1 次（300–600 ms jitter）、熔断 10 次/30 s 半开。错误：`BgmHttpError` / `BgmNetworkError` / `BgmCircuitOpenError`；`getSubject(id)` 404 → `null`。

### 6.5 点击预览弹窗（V3）
点击条目卡片打开**唯一**居中弹窗；面板内容与布局沿用 Round 3 V2（封面槽/右栏/简介/标签滚动不变），宽 `min(880px, 100vw-176px)`、高 `min(max(100vh-80px,420px),100vh-72px)`，视口水平+垂直居中（1440×900 为 `880×820 @ (280,40)`；1024 为 `848`；768 为 `592`）。
右侧独立 **56×56**「BGM」按钮：位于面板右缘外，**按钮顶边与面板顶边同 y**，间距 20（≥1280）/16（≤1279）；新标签打开 bgm.tv，弹窗保持。遮罩 `rgba(15,23,42,0.22)` + `blur(2px)`，覆盖含 Header 的全屏；背景 inert、body 滚动锁定并补偿滚动条。
关闭：**右键任意位置**（阻止浏览器菜单）、**Esc**、**左键点遮罩空白**；点面板/按钮不关闭；底部轻提示。打开为**弹性 pop**：遮罩 opacity 180ms，面板 opacity 160ms + `scale(0.92) translateY(6px) → scale(1) translateY(0)` 220ms 轻微回弹，BGM 按钮 220ms + 25ms delay；关闭 140ms `scale→0.97` + opacity→0。`prefers-reduced-motion` 关闭缩放/位移/回弹。**≥768 且鼠标设备启用**；触屏与 <768 点击仍直接打开 bgm.tv。悬浮不请求 preview/summary/原图，只在打开后加载；`subject.preview/summary` 字段与封面回退链不变。

### 6.6 URL 状态
`tag / q / types / from / to / sort / scoreless / page`；默认值省略；`types` 逗号分隔；非法值回退默认。筛选变化 300 ms debounce 后 `router.replace(..., {scroll:false})` 并重置 `page=1`。

---

## 7. 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 开发服务器（8004） |
| `pnpm exec next dev -H 0.0.0.0 -p 9004` | 对外访问（本项目当前使用） |
| `pnpm build` / `pnpm start` | 生产构建 / 启动 |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest（单元 + 真实数据集成，共 207 项） |
| `pnpm test:e2e` | Playwright（17 条；需 `PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers`） |
| `pnpm db:generate` / `db:push` | Prisma Client / 建表 |
| `pnpm db:import` | JSONL → SQLite（幂等，约 27–31 s；会重写 `docs/data-report.md`） |
| `node --env-file=.env scripts/verify-db.mjs` | 计数/完整性/性能校验 |
| `pnpm exec vitest run src/server/cover` | 只跑某个模块 |

质量门禁：**`pnpm test` 全绿 + `pnpm typecheck` 0 error**；改 UI/交互时再跑 `pnpm test:e2e`，涉及构建时跑 `pnpm build`。真实数据集成测试若报 SQLite `code 14`，用 `TMPDIR=$PWD/.tmp` 重跑（环境已知问题）。

---

## 8. 验证与测试布局

- `src/server/tag-dsl/{parser,compiler}.test.ts`：优先级、括号、取反、引号/转义、错误位置；编译出的 SQL 在内存 SQLite 上执行验证真值。
- `src/server/search/subject-search.integration.test.ts`：真实 `prisma/dev.db`（无库自动 skip），断言 700,108 / 7,331 / 8,084 / 31,258 / 422,912、排序、分页夹取、unknown tag。
- `src/server/bgm/bgm-client.test.ts`：token header、重试、熔断、限速（fake fetch）。
- `src/server/cover/cover-service.test.ts`：缓存、TTL、URL 回退、失败不缓存（fake client）。
- `src/server/api/routers/subject.test.ts`：covers/preview/summary 契约，含 `CoverUrls.large` 与回退。
- `src/lib/*.test.ts`：url-state 往返、tag-insert 转义、tag-parse-lite、format、cover-batch、preview（大图候选链/人数排名文案）。
- `src/server/api/routers/preview-utils.test.ts`：标签解析容错/去重/排序。
- `e2e/dialog*.spec.ts`、`e2e/preview*.spec.ts`：Playwright 真实浏览器（点击弹窗、四档居中与按钮顶边、右键/Esc/遮罩关闭、焦点、滚动锁、<768/触屏直跳、悬浮零请求、暖缓存重开 P1、非 2:3 占位 P2）。

手工验收：`docs/qa-report-round4.md` 是当前 UI 验收（弹窗 V3）；`docs/qa-report-round3.md` 为 V2 历史证据；更早见 `docs/qa-report.md`。API 可直接 GET：
```bash
curl --get --data-urlencode 'input={"json":{"tagExpr":"科幻 & 百合","page":1}}' \
  http://127.0.0.1:9004/api/trpc/subject.search
```

---

## 9. 已知问题与待办（按优先级）

| # | 事项 | 说明 |
| --- | --- | --- |
| 1 | 弹窗遮罩 | Round 4 改为点击弹窗：打开时全屏淡灰遮罩、背景 inert、body 锁定；右键 / Esc / 点遮罩关闭。<768 与触屏不启用（点击直跳 bgm.tv），是已确认取舍。 |
| 2 | 弹窗跨浏览器 | focus trap / `aria-modal` / `inert` / 滚动条补偿已在 Chromium 验证；Firefox/Safari 与真实经典滚动条未实测。 |
| 3 | 顶部分页定位 | 筛选区取消吸顶后，`scroll-mt-16` 只保证结果区停在 Header 下；可再优化滚动体验。 |
| 4 | 冷启动封面 | 50 条全未缓存约 12 s；可加大首块（10→20）或后台预热热门条目（`rank` 非空 43,604 条约 3 小时）。 |
| 5 | 名称搜索 | `LIKE '%x%'` 全表扫描约 40–100 ms；数据再增长可上 FTS5。 |
| 6 | 缓存跨 dump | `cover_cache` 无 dump 版本标记；换 dump 后需手动清 `.cache/covers.db`（或提升 `user_version`）。 |
| 7 | 加权参数 | `m=50` 为当前 dump 校准值；`C` 自适应，`m` 固定。 |
| 8 | 多实例限流 | 限速/熔断为进程内单例；多实例部署额度会叠加。 |
| 9 | NSFW 个体差异 | 上游对 NSFW 的隐藏不严格对应本地 `nsfw` 字段；负缓存 TTL 会延迟反映上游策略变化。 |
| 10 | 截图字体 | CI/无头环境缺 CJK 字体，截图中文显示方块；不影响页面实际显示。 |
| 11 | 原图体积差异 | 预览原图实测 120–560 KB（1800×2500 最大），慢网点击后等待更久；仅点击打开时加载、暖缓存/重复打开不再下载。若需更快可改用 `/r/800`（非原图）或另做点击放大。 |
| 12 | 标签区溢出 | 当前 dump 每条最多 10 个标签，1440/1024/768 下标签区不触发滚动；容器已实现内部滚动，数据增长后需复测。 |
| 13 | 双击条目 | 双击时第一击打开弹窗，第二击可能落在遮罩上立即关闭（观察项，未特殊抑制；不影响单击）。 |
| 14 | 触屏与窄屏 | <768 与 `(hover:none)` 不启用弹窗，点击仍直接新标签打开 bgm.tv（Round 4 已确认）。 |
| 15 | 动效中途关闭 | 打开动画未完成（约 <100ms）时关闭，面板会从接近终态开始淡出，产生一次极短视觉跳变；正常打开完成后再关闭不受影响（P2 观察项，未修）。 |

---

## 10. 故障排查

| 现象 | 原因 / 处理 |
| --- | --- |
| `Unknown field summary` / Prisma 类型过期 | 改 schema 后未重启 dev；或没跑 `prisma generate`。重启 + generate。 |
| 页面白屏 / 500，日志提示表不存在 | `prisma/dev.db` 未导入：`pnpm db:import`。 |
| 封面全都没有 | 未联网 / token 失效 / 缓存负命中；看 `.cache/covers.db` 的 `reason`，必要时删负缓存行或整个文件。 |
| NSFW 封面 404 | 未配 `BGM_API_TOKEN` 或令牌无权限；配好后重启，等 1 天负缓存过期或删缓存。 |
| 端口占用 | `ss -ltnp \| grep 8004`，结束旧进程；对外用 `-p 9004`。 |
| dev 进程 EPIPE 刷屏 | 终端/管道断开导致；直接结束进程重启（不要用 inspector 改 stdout）。 |
| `pnpm install` 报 ERR_PNPM_IGNORED_BUILDS | 检查 `pnpm-workspace.yaml` 的 `allowBuilds` 是否包含 prisma/esbuild/sharp 等。 |
| `pnpm install` 报 ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK | 沙箱拒绝写 `XDG_RUNTIME_DIR`：`mkdir -p .runtime .tmp && chmod 700 .runtime` 后 `XDG_RUNTIME_DIR=$PWD/.runtime TMPDIR=$PWD/.tmp pnpm install`。`.npmrc` 的 store-dir/cache-dir 在 pnpm 12 为 no-op。 |
| 导入超时/中断 | 脚本幂等，直接重跑；确认磁盘 ≥4 GB、dump 文件完整。 |

---

## 11. 交给下一位 Agent 的工作方式建议

1. **先读**：`docs/requirements.md`（要什么）、`docs/architecture.md`（怎么实现）、本文件（怎么跑）。
2. **小步提交**：一次只改一个关注点，改完立刻 `pnpm test && pnpm typecheck`，再 commit。
3. **文件所有权**：多人/多 Agent 并行时按模块划分（前端 `src/components`、`src/lib`；服务端 `src/server/*`；数据 `scripts/`），避免互相覆盖。
4. **真实数据验证**：涉及查询/SQL/排序的改动，必须在真实 `prisma/dev.db` 上跑一次，不要只靠 mock。
5. **不伪造结果**：测不出来就写「未验证」，不要编造数字。
6. **保护秘密**：token 只在 `.env.local`，不打印、不入库、不写进文档。
7. **提交前检查**：`git status` 不应出现 `dump-db/`、`prisma/*.db`、`.cache/`、`.env.local`。
8. **UI 改动尽量截图**：Playwright 在环境里可用时，把截图放 `docs/screenshots/` 并在回复中给出路径。

---

## 12. 交接自检清单

- [ ] `pnpm install && pnpm db:generate && pnpm db:push` 成功
- [ ] dump 可用（共享目录经 `DUMP_DIR` 指向，或本地 `dump-db/subject.jsonlines`，约 700,108 行）
- [ ] `pnpm db:import` 成功，`Subject` = 700,108、`SubjectTag` = 2,267,357
- [ ] `pnpm test` 全绿、`pnpm typecheck` 0 error；UI 改动再跑 `pnpm test:e2e`（17 条）与 `pnpm build`
- [ ] `pnpm dev` 打开首页：默认「综合评分」、50 条、封面可见
- [ ] 输入 `科幻` → 总数 7,331；`科幻 &&` → 红字语法错误
- [ ] 点击结果行 → 居中弹窗出现：原图完整（不裁边/不放大）、标题/标签/简介齐全，简介可滚且页面不动；右上角 56×56 BGM 按钮顶边与面板顶边齐平
- [ ] 弹窗内右键 / Esc / 点遮罩空白关闭；点面板/BGM 按钮不关闭；BGM 新标签打开且弹窗保持
- [ ] 悬浮结果行不再出现预览、不发 preview/summary/原图请求；<768 与触屏点击直跳 bgm.tv
- [ ] 方形/非 2:3 封面加载后无灰色衬底；无封面/失败显示占位
- [ ] `.env.local` 未入库；`.cache/`、`prisma/dev.db` 均被忽略

---

## 13. 相关文档

- 需求：`docs/requirements.md`
- 架构与接口契约：`docs/architecture.md`
- UI 交互设计：`docs/ui-design.md`
- 数据导入报告：`docs/data-report.md`
- QA 验收报告（含历史迭代）：`docs/qa-report.md`
- 封面可行性调研：`docs/cover-research.md`
- 团队分工与数据基线：`docs/team-plan.md`
- Round 3 需求 / 计划 / 设计规格：`docs/round3-requirements.md`、`docs/round3-plan.md`、`docs/round3-ui-spec.md`
- Round 3 QA 报告（预览 V2 历史）：`docs/qa-report-round3.md`
- Round 4 需求 / 设计规格：`docs/round4-requirements.md`、`docs/round4-ui-spec.md`
- Round 4 QA 报告（点击弹窗 V3）：`docs/qa-report-round4.md`
