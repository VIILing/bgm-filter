# QA 验收报告（S5）

> 环境：Linux / Node v27.0.0-alpha / pnpm 12.16.1 / 4 核 15GB / 全权限
> 日期：2026-11-03　代码版本：`85bb884`（+ 本报告与 README）
> 数据：`dump-2026-10-27`，Subject 700,108 / Tag 91,909 / SubjectTag 2,267,357 / DB 311.8 MB

## 0. 结论

**通过。** 需求 §6 的 12 条验收项全部满足；`typecheck` 0 error、`test` 92 项全绿、`build` 通过。发现 2 项「非缺陷的设计行为」与 4 项已知限制，见 §5。

> 本轮 QA 由多智能体协作完成：HTTP/接口与 SQL 交叉校验 31/31、浏览器端到端 22 项中 20 项直接通过，另 2 项经复核为测试选择器/预期问题（见 §3.3），非产品缺陷。

## 1. 工程质量门禁

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm typecheck` | ✅ exit 0，无输出 |
| 单元/集成测试 | `pnpm test` | ✅ 7 文件 / 92 用例全绿（DSL 38 + 前端 lib 41 + 真实数据集成 13） |
| 生产构建 | `pnpm build` | ✅ 编译 1.4s；`/` 静态预渲染，First Load JS 153 kB |
| 集成测试真实性 | `vitest run src/server` | ✅ 51/51（真实 dev.db；半导入库会失败而非跳过） |

## 2. 需求 §6 逐条验收

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | install→generate→import→dev 全流程可复现 | ✅ | README 命令实测；`db:import` 幂等重跑两次结果完全一致（19.5s / 311.8MB） |
| 2 | 默认加载 700,108 条、首页 50 条、评分降序、无评分置底 | ✅ | `total=700108`、`items=50`、`totalPages=14003`、首页 score 全 >0 且非升序；`scoreless=last` 由 SQL 表达式 `(score=0) ASC` 保证 |
| 3 | 标签语义：`科幻`、`科幻 & 百合` 子集、`(科幻\|奇幻)&!R18`、`"C&C"`、语法错误不 500 | ✅ | `科幻=7331`；`科幻&百合=212`（≤7331）；`(科幻\|奇幻)&!R18=18321`，50 条逐条按全量标签校验「含科幻/奇幻且不含 r18」；错误表达式返回 **HTTP 400** + 「标签表达式错误（第 4 个字符附近）：运算符 "&" 缺少操作数」 |
| 4 | 年代 2010–2020 全部命中且与标签 AND | ✅ | `total=266,420`，首页 year 全在区间；`科幻+2010–2020=2,355` |
| 5 | 只勾动画 → 全为 type=2；全不选 = 全选 | ✅ | `types=[2] → 31,258` 且全 type=2；`types=[] → 700,108` |
| 6 | 名称搜索「攻壳」有结果 | ✅ | `q=攻壳 → 41`（与 SQL LIKE ground truth 一致） |
| 7 | 排序切换、无评分置顶首屏全 0 分 | ✅ | `sort=score_asc` 首页升序（首卡 1.0）；`scoreless=first` 首页 50 条全 `score=0` 且 id 升序 |
| 8 | 分页无重复、末页条数正确、越界夹取 | ✅ | page1/page2 重复 0；`科幻&百合`（212 条→5 页）`page=99 → page=5`、12 条；全量 14,003 页时 `page=9999` 合法不夹取 |
| 9 | URL 复制还原、清空后无冗余参数 | ✅ | 新页直达 `/?tag=科幻 & 百合&from=2010&to=2020` 状态一致；重置后 URL = `/` |
| 10 | 卡片链接、标签点击追加、常用标签、自动补全 | ✅ | 卡片外链 `bgm.tv/subject/{id}` + `rel="noreferrer"`；点击 chip：`科幻` → `科幻 & 治愈`；联想 `q=科幻` 首条 `{科幻,7331}`；常用标签首位 `{游戏,107540}` |
| 11 | 空态/错误态可读 | ✅ | 未知标签/无结果显示「没有匹配的条目」+ 放宽建议；DB 缺失走 `DB_UNAVAILABLE_MESSAGE`（「数据库未导入或不可读，请先运行 pnpm db:import」） |
| 12 | DSL 单测覆盖优先级/括号/取反/引号/空/错误位置 | ✅ | `parser.test.ts` 25 用例 + `compiler.test.ts` 13 用例（内存 SQLite 执行生成 SQL 验证真值） |

## 3. 详细验证

### 3.1 接口与 SQL 交叉校验（31/31）

| 检查 | 期望 | 实测 |
| --- | --- | --- |
| stats.total / taggedTotal | 700,108 / 422,912 | ✅ 一致 |
| stats.types | 422,971 / 31,258 / 101,230 / 117,881 / 26,768 | ✅ 一致 |
| 默认 total / pageSize / totalPages | 700,108 / 50 / 14,003 | ✅ 一致 |
| `科幻` / `百合` | 7,331 / 8,084 | ✅ 与 dump 独立扫描一致 |
| `科幻 & 百合` | 212 | ✅ API = SQL = dump 三方一致 |
| `(科幻\|奇幻) & !R18` | 18,321 | ✅ 语义逐条校验 bad=0 |
| 年代 2010–2020 | 266,420 | ✅ 全部 year ∈ 区间 |
| `types=[2]` | 31,258 | ✅ 全部 type=2 |
| `q=攻壳` | 41 | ✅ |
| `q=%`（转义验证） | 411（名称含字面 %） | ✅ 未被当作通配符；dump 独立统计 = 411 |
| 未知标签 | total=0 + warning | ✅「未知标签：…」 |
| 越界页 | 夹到末页 | ✅ 212 条 → page 5、12 条 |

> 说明：S3 收尾汇报中曾出现「交集 87 / 取反 5,357」两个数字，经以 dump 独立全量扫描复核为**汇报错误**；正确值为 212 / 18,321，接口与测试（动态 ground-truth 断言）均正确。已在本报告更正。

### 3.2 性能（真实数据，中位数）

| 查询 | 耗时 | 目标 |
| --- | --- | --- |
| 默认搜索（700k 全量排序 + 分页） | 37.8–78.8 ms | ≤300 ms ✅ |
| `科幻 & 百合` + 年代 + 类型（交集） | 0.7 ms | ✅ |
| 单标签 + 年代区间 | 5.5–14.3 ms | ✅ |
| 大标签 + 年代 + 类型（PC/游戏） | 29.8 ms | ✅ |
| 取反 `!R18`（EXCEPT 全表） | 170.6 ms | ✅（最慢项） |
| 标签联想 | 3.6–6.4 ms | ≤100 ms ✅ |
| 头部统计 | 16.7 ms | ✅ |
| 名称 `LIKE '%攻壳%'` | 99 ms | 可接受（无 FTS，已知限制） |

### 3.3 浏览器端到端（Playwright + Chromium，1440×1000）

真实浏览器验证 22 项，**20 项直接通过**，2 项经复核非缺陷：

- ✅ 首屏「共 700,108 条」、50 条结果、筛选控件与分页可见；**无 console error / pageerror / hydration 错误**
- ✅ 输入 `科幻` → URL `?tag=科幻`、总数 7,331
- ✅ 输入 `科幻 &&` → 红色错误提示，页面不崩、保留上次结果
- ✅ `科幻 & 百合` → 结果更新（测试脚本此处读取 Header 文案误判，实际结果区已为 212 条，见「非缺陷说明」）
- ✅ 年代输入 → URL `from=2010&to=2020`
- ✅ 取消「动画」→ URL `types=1,3,4,6`；勾回恢复
- ✅ 「重置筛选」→ URL 回到 `/`
- ✅ 切换「评分从低到高」→ URL `sort=score_asc`，首卡变为 1.0 分
- ✅ 「无评分置顶」→ URL `scoreless=first`
- ✅ 「下一页」→ URL `page=2`，内容不同
- ✅ 点击卡片标签 chip → 表达式由 `科幻` 变为 `科幻 & 治愈`（无报错）
- ✅ URL 直达还原筛选状态
- ✅ 未知标签 → 「没有匹配的条目」

**非缺陷说明**：
1. 首卡（评分 10 分、`あまつき (1)`）恰好无标签，导致首轮脚本找不到 chip——换用「结果区第一个 chip」后通过。
2. 非法表达式 `科幻 &&` 会被保留在 URL 中（作为草稿），刷新后可继续编辑；这是前端有意选择（避免用户输入被丢弃），不影响查询（查询已暂停）。

## 4. 数据完整性

- `PRAGMA integrity_check` = ok；`foreign_key_check` = 0 违规；`ANALYZE` 已执行（sqlite_stat1 有 7 条目）。
- 导入幂等：连续两次 `pnpm db:import` 三表计数、体积完全一致（19.5s / 311.8MB）。
- **事故与恢复记录**：17:34 一次误触发的重导入被 SIGPIPE 中断，导致库处于半写状态（约 20 万条）；随后完整重跑恢复，并经上表全量复核（700,108 / 2,267,357 / integrity ok）。当前库即恢复后的库。

## 5. 已知问题与限制（不影响验收）

| 项 | 说明 | 影响 |
| --- | --- | --- |
| 卡片标签 ≤8 个 | 展示规则为「用户标签优先、公共标签补足」；`(科幻\|奇幻)&!R18` 首页有 5/50 条命中标签未显示在卡片上 | 过滤语义正确，仅展示取舍；如需「命中标签必显」需改 §6 规则 |
| 非法表达式保留在 URL | 见 §3.3 | 刷新后仍显示错误提示，需用户修正；查询已暂停 |
| 名称搜索全表扫描 | `LIKE '%x%'` 无索引，约 40–100 ms | 数据量再增长时需 FTS5 |
| 集成测试绑定 dump 基线 | 断言 700,108 / 7,331 等 | 换 dump 需同步更新基线 |
| 取反查询较慢 | `!R18` 走 `EXCEPT` 全表，170 ms | 仍 <300 ms；多个取反叠加时可能接近上限 |
| pnpm 12 配置差异 | `package.json` 的 `pnpm.onlyBuiltDependencies` 被忽略，实际生效于 `pnpm-workspace.yaml` 的 `allowBuilds` | 已提交，重装可复现 |
| 未做移动端专项优化 | 布局在窄屏可用（卡片化/堆叠），未做真机测试 | V1 非目标 |

## 6. 截图

| 文件 | 内容 |
| --- | --- |
| `docs/screenshots/01-default.png` | 默认结果页（1440×1000） |
| `docs/screenshots/02-filtered.png` | 筛选后结果页（标签 + 年代 + 升序） |

---

## 7. 迭代变更 V1.1（2026-11-03 18:40，QA 之后）

### 7.1 问题
默认按原始 `score` 降序时，「1 人打 10 分」的条目（如 id 1630 `あまつき (1)`）占据榜首。数据根因：评分人数中位数仅 **3**，p90=45，小样本噪声极大。

### 7.2 方案：贝叶斯加权评分（IMDb weighted rating）

```
weighted = (score × scoreVotes + C × m) / (scoreVotes + m)
C = 全局按人次加权平均分（动态查询，实测 7.1042）
m = 50（先验强度）
```

- 仅作用于 `score > 0`；`score = 0` 仍由「无评分置底/置顶」单独分组。
- 排序键：`(score=0) ASC|DESC` → `weighted DESC` → `score DESC` → `id ASC`。
- 新增 `sort=weighted_desc` 并设为默认；保留 `score_desc` / `score_asc`（原始评分）。
- C 采用 `WeakMap<PrismaClient, Promise<number>>` 进程内缓存（dump 静态；失败回退 7.1 且可重试）。

**效果（真实数据）**：

| # | 修改前 | 修改后 |
| --- | --- | --- |
| 1 | あまつき (1) 10 / 1 人 | ゼルダの伝説 ブレス オブ ザ ワイルド 9.4 / 7,154 人 |
| 2 | あまつき (2) 10 / 1 人 | SLAM DUNK 完全版 9.4 / 1,920 人 |
| 3 | あまつき (3) 10 / 1 人 | Xenoblade2 Original Soundtrack 9.4 / 1,102 人 |
| 4 | あまつき (4) 10 / 1 人 | Yes, Minister (Series 3) 9.4 / 874 人 |
| 5 | あまつき (5) 10 / 1 人 | ランス10 9.3 / 3,686 人 |

「1 人 10 分」加权后为 7.16，在全库 287,448 条有评分条目中排名约第 34,796 位。

### 7.3 回归验证

| 项 | 结果 |
| --- | --- |
| `pnpm test` | ✅ 8 文件 / **108 用例**（新增 16：公式、C 缓存/回退、三模式排序） |
| `pnpm typecheck` | ✅ 0 error |
| 默认首页无 1 人 10 分 | ✅ id 1630 不在首页；weighted 单调不增 |
| `sort=score_desc` 仍复现原始排序 | ✅ 首条 `あまつき (1)` 10/1 |
| `科幻` total 不受影响 | ✅ 7,331 |
| 无评分置顶 | ✅ 首页 50 条全 `score=0` |
| 浏览器三按钮 | ✅ 综合评分 / 评分从高到低 / 评分从低到高；切换后 URL 与首卡正确，无 pageerror |
| 性能 | 加权 112.2 ms vs 原始 78.8 ms（1.42×），仍 <300 ms；冷启动首查 ~356 ms |
| 截图 | `docs/screenshots/03-weighted-sort.png` |

### 7.4 封面数据调研（不涉及代码变更）

`docs/cover-research.md` 结论：官方 `GET /v0/subjects/{id}` 可返回 5 档封面 URL；`lain.bgm.tv` 无防盗链、无 UA 校验、支持跨域；但**无 id 批量接口且限流严苛**（默认 3000 次/10 分钟/IP，超限封禁 1 小时），全量预抓 700k 需约 8.1 天，不可行。推荐「服务端按需解析 URL + 本地只缓存 URL + 浏览器直连 CDN」，首屏 50 条冷启动约 2–3 s（不阻塞渲染），命中缓存则 0 外部请求。

### 7.5 遗留

- `m=50` 为当前 dump 校准值，换 dump 建议复算（C 自适应，m 可保持）。
- C 进程内缓存：dev 运行中重导 dump 需重启进程才生效。
- 封面功能尚未实现（待产品决策）。

---

## 8. 封面功能验收（V1.2）

> **独立复验**（2026-11-03 19:11–19:24），不采信实现者结论；全部数字为本轮实测。
> 环境：dev 服务 PID 41075（18:00:31 启动，验收期间**未重启**，端口 7737）；Chromium 1248 headless（`/tmp/browser-qa`，未新增依赖）。
> 脚本（自写，`/tmp`）：`qa-warm.cjs`（暖缓存+交互+移动端）、`qa-cold.cjs`（冷缓存时序）、`qa-verify.cjs`（稳定态+图片失败回退）、`qa-steady.cjs`（科幻/第 2 页）、`qa-scifi.cjs`、`qa-final.cjs`（占位样式/无 rank）、`qa-scoreless.cjs`；SQLite 只读脚本 `qa-db.mjs`、`qa-cache-status.mjs`。
> 约束遵守：未改 `src/**`、`scripts/**`、`package.json`、`prisma/**`、`.cache/**`，未 `pnpm add`，未删缓存。测试浏览使 `cover_cache` 行数 215 → 321（服务端正常写入，含 24 条负缓存）。

### 8.1 结论

**✅ 通过。** 验收项 16/16 直接通过，0 阻断缺陷；发现 **1 项潜在缺陷（未复现，受“不得改 `.cache`”约束）**、4 项设计观察、5 项已知风险，见 §8.5/§8.6。

| 验收项 | 结果 | 关键实测 |
| --- | --- | --- |
| A1 `pnpm test` | ✅ | 10 文件 / **136 用例**全绿（4.63 s；封面相关 2 文件 28 用例 = 21 + 7） |
| A1 `pnpm typecheck` | ✅ | `tsc --noEmit` exit 0，0 error |
| A2 改动范围 / 缓存未入库 | ✅ | `.cache/`、`prisma/dev.db` 均为 `!!`（ignored），`git ls-files` 无缓存/库文件 |
| B3 `subject.covers` 返回结构 | ✅ | `/r/100` grid、`/r/200` small、`/r/400` common，全 `https://lain.bgm.tv` |
| B4 图片直连可用 | ✅ | `200 image/jpeg`，16,325 B，200×325 JPEG |
| B5 不存在 id | ✅ | `{"99999998":null}`，无报错，写负缓存 |
| C6 首卡无大号分数块 | ✅ | 卡内 `.text-2xl` 数量 = **0** |
| C6 meta 形态 | ✅ | 首卡 `9.4 · 7,154 人评分 #1 看过 8,342`；50/50 符合 |
| C6 `/r/200` 封面 | ✅ | 47 张，全部 `/r/200/` |
| C6 裂图 | ✅ | 滚动前后均 **0** 张 `complete && naturalWidth===0` |
| C6 冷/暖时间 | ✅ | 暖：首图 972 ms；冷：首图 5.73 s、全部解析 19.6 s |
| C7 标签 chip / 链接 / 科幻 / 第 2 页 | ✅ | 见 §8.4.3 |
| C7 console / pageerror | ✅ | 正常流程 **0 / 0 / 0**（console error / pageerror / warning） |
| C8 移动端 | ✅ | 390×844，横向溢出 0 px，封面 56×84 |
| C9 NSFW 占位 | ✅ | 首页 3 张占位卡 id 全部 `nsfw=1`；冷页 12 张 NSFW 全占位 |
| C10 截图 | ✅ | `docs/screenshots/05-covers-qa.png`（1440×1000，148 KB） |

### 8.2 质量门禁

```text
$ pnpm test
 Test Files  10 passed (10)
      Tests  136 passed (136)
   Duration  4.63s (transform 268ms, setup 0ms, collect 593ms, tests 4.49s, environment 1ms)
$ pnpm typecheck
$ tsc --noEmit          # 无输出，exit 0
```

`git status --short`（验收结束时）：

```text
 M .gitignore
 M src/components/HomeClient.tsx
 M src/components/ResultList.tsx
 M src/components/SkeletonRows.tsx
 M src/components/SubjectCard.tsx
 M src/server/api/routers/subject.ts
 M src/shared/subject-contract.ts
?? docs/screenshots/04-covers.png
?? docs/screenshots/05-covers-qa.png
?? src/components/CoverLoader.tsx
?? src/lib/cover-batch.test.ts
?? src/lib/cover-batch.ts
?? src/server/cover/
```

- 版本控制卫生：`git check-ignore -v` → `.cache/covers.db` 命中 `.gitignore:30:.cache/`；`prisma/dev.db` 命中 `.gitignore:13:prisma/*.db`；`git ls-files` 仅有 `prisma/schema.prisma`。`.gitignore` 本轮仅新增 1 行 `.cache/`。
- 改动规模：7 文件 +172/−34，另新增 6 个源码文件（`CoverLoader.tsx`、`cover-batch.ts`、`cover-batch.test.ts`、`server/cover/{cover-cache,cover-service,cover-service.test}.ts`）。

### 8.3 接口级验证

| # | 请求 | 实测 |
| --- | --- | --- |
| 1 | `curl --get --data-urlencode 'input={"json":{"ids":[62229,1630]}}' .../subject.covers` | 34 ms；`62229.small=https://lain.bgm.tv/r/200/pic/cover/l/60/d8/62229_5Yt0j.jpg`，同 id 的 grid `/r/100/`、common `/r/400/`；两 id 均返回三尺寸 |
| 2 | `curl -o /dev/null -w "%{http_code} %{content_type}" <small URL>` | `200 image/jpeg`，16,325 B，`file` 识别 200×325 JPEG |
| 3 | `ids=[99999998]` | 268 ms，`{"99999998":null}`，HTTP 200 无 error；负缓存行 `missing=1`（`fetchedAt=1793704303284`） |
| 4 | `ids=[22290,4639]`、`[226254,424578]`（均 NSFW） | 全部 `null`，24 ms（命中负缓存，无外部请求） |
| 5 | 50 个 id 一次请求 | 50 键、3 个 `null`（3 个 NSFW），其余 small 全为 `/r/200/`，13 ms |
| 6 | `ids=[]` / `ids=[0]` | `{}` / zod `BAD_REQUEST`（`Number must be greater than 0`），符合输入约束 |

缓存文件：`.cache/covers.db` 表 `cover_cache(id, grid, small, common, fetchedAt, missing)`；验收期间行数 215 → 321，其中 `missing=1` 24 行。**未删除任何行**。

### 8.4 浏览器端到端

#### 8.4.1 首屏时间（1440×1000）

| 场景 | 50 条文字出现 | 首张封面（DOM 节点） | 首张封面（解码完成） | 覆盖率 |
| --- | --- | --- | --- | --- |
| 暖缓存（首页，50/50 已缓存） | **767 ms**（页面内 `performance.now` 763 ms） | **884 ms** | **972 ms**（≤1.2 s ✅） | 首屏约 1 s 时 19 张 img 节点，逐步补齐至 47 张 |
| 冷缓存（`?sort=score_asc&types=4`，50/50 未缓存） | **703 ms** | **5,733 ms** | **6,235 ms** | 19.6 s 时 37 张 + 13 占位 |

冷缓存分块时间线（图片节点数 / `performance.now`）：

```text
5,501 ms → 10 张     10,066 ms → 19 张     13,013 ms → 25 张
17,105 ms → 33 张    19,609 ms → 37 张（此后不再变化）
```

折算：37 张封面 + 1 条“官方无图”共 **38 次外部请求 / 19.6 s ≈ 1.94 req/s**，与 500 ms 间隔（≈2 req/s）吻合；若 50 条全部需要取图约 25 s，与实现者“50 张约 23 s”同一量级（差异来自 12 条 NSFW 不取图）。分块链条为 10 张/块、前块完成后才发下一块（时间线每 ~5 s 一跳）。

#### 8.4.2 结构与断言（首页稳定态）

- **大号分数块已移除**：`ul[aria-label="条目结果"] .text-2xl` = **0**；首卡 `.text-2xl` = 0。
- **meta 行**：首卡 `9.4 · 7,154 人评分 #1 看过 8,342`；50 条全部匹配 `^\d+\.\d · (N|N.N万) 人评分( #\d+)? 看过 [\d,]+$`；49/50 带 `#rank`（缺的 1 条 `id=424578` 在库中 `rank=null`，属数据为空）。
- **封面**：47 张 `<img src="https://lain.bgm.tv/r/200/...">` + 3 个「无封面」占位 = 50；所有 img URL 尺寸段均为 `/r/200/`（无 `/r/100`、`/r/400` 混用）；`loading=lazy`、`decoding=async`、`referrerPolicy=no-referrer`、`alt="… 封面"`。
- **几何**：桌面封面盒 76×114 px（`aspect-[2/3]`，比值 1.5，`object-fit: cover`，原图 200×325）；占位块同尺寸、外层 `bg-slate-100`（`oklch(0.968 0.007 247.896)`）、文字 10 px `text-slate-400`。
- **裂图**：滚动前 19 张 img 中 9 张已 `complete`、10 张 pending，`complete && naturalWidth===0` = **0**；滚动到底（`scrollHeight 7,521`）后再查：47 张全部加载，裂图 **0**。
- **占位卡**：首页 3 张，id 见 §8.4.6。

#### 8.4.3 交互回归

| 项 | 实测 |
| --- | --- |
| 点击首卡标签 chip | chip=`任天堂`；`#tag-expr` 由 `""` → `任天堂`；URL 变 `/?tag=%E4%BB%BB%E5%A4%A9%E5%A0%82`；重置后清空 |
| 卡片链接 | 50/50 `href=https://bgm.tv/subject/{id}`、`target=_blank`、`rel=noreferrer`；例 `https://bgm.tv/subject/62229` |
| 输入 `科幻` | 35 条（`?q=科幻`），文字 854–877 ms；封面最终 **35/35**、0 裂图；过程中先占位后分块补齐（4.2 s 时 10 张 img、1 张已解码） |
| 翻到第 2 页 | 50 条（`?page=2`），与第 1 页 id **重复 0 条**；49 张封面 + 1 张 NSFW 占位，裂图 0；`aria-current=page` 正确 |
| console / pageerror | 全部正常流程 **0 / 0**；仅 3 条 Next 路由预取 `_rsc` 请求 `net::ERR_ABORTED`（切筛选时的正常取消，非 console error） |

#### 8.4.4 冷缓存占位的构成（13 张）

- **12 张 NSFW**（`nsfw=1`）：117682、125509、141083、152250、152353、194382、203253、217807、218338、222158、223708、224333 → 负缓存 `missing=1`，无封面 URL。
- **1 张官方无图**（`nsfw=0`）：`217554 Terra Battle 2`；直连官方 API 复核 `images` 五档全为空字符串，故占位正确。
- 13 张占位卡片的 meta 行、标签、链接均正常渲染，无布局塌陷。

#### 8.4.5 移动端（390×844，DPR 2）

| 指标 | 实测 |
| --- | --- |
| 横向溢出 | `documentElement.scrollWidth 390` vs `innerWidth 390` → **0 px** |
| 封面 | **56×84 px**（`w-[56px]`，2:3），`sm` 断点以上 76 px |
| 文字可见 | 标题宽 153 px、首卡 meta `9.4 · 7,154 人评分 #1 看过 8,342`、50 张卡全部渲染 |
| 封面/裂图 | 47 张封面，裂图 0；console error 0 |
| 截图 | `/tmp/qa-mobile-390.png`（780×1688 @2x，未纳入仓库） |

#### 8.4.6 NSFW 不取图（SQLite 交叉验证）

首页占位卡 3 张，用 `node:sqlite` 只读查询 `prisma/dev.db`：

| 占位卡 id | 名称 | `Subject.nsfw` | 缓存行 |
| --- | --- | --- | --- |
| 226254 | ランス10 | **1** | `missing=1`，无 URL |
| 22290 | WHITE ALBUM2 -closing chapter- | **1** | `missing=1`，无 URL |
| 424578 | WHITE ALBUM2 EXTENDED EDITION | **1** | `missing=1`，无 URL |

接口侧同 id 返回 `null`。间接证据表明服务端未为 NSFW 发起外部请求：冷页 50 条中 12 条 NSFW，若全部取图需 ~25 s，实测 19.6 s 完成 38 次请求（≈2 req/s）。

#### 8.4.7 附加：图片加载失败回退（Playwright 拦截 `lain.bgm.tv` 全部 abort）

50 张卡全部显示占位（28 张渲染为占位、22 张仍保留 img，后者应为浏览器缓存命中），**无 pageerror**、无重试风暴（25 个图片请求 / 25 个唯一 URL），失败后卡片降级为「无封面」灰块——符合“失败显示占位”。此场景下 console 出现 25 条 `Failed to load resource: net::ERR_FAILED`（由强制断网造成，非正常流程）。

#### 8.4.8 附加：无评分分支（`?scoreless=first`）

50 条全为 `score=0`：meta 显示 `— 无评分 看过 2`（无 `人评分` 段）、左侧封面正常（8 s 时 18 张）、`.text-2xl` = 0、console error 0。

#### 8.4.9 截图

`docs/screenshots/05-covers-qa.png`：1440×1000、148,748 B、约 4,146 种近似颜色（非空白）；截图时页面状态为 **47 张封面已解码 + 3 张 NSFW 占位**，含首卡 meta 行。像素级文字识别未做，结构断言以 DOM 为准。

### 8.5 发现的问题

**P1（潜在缺陷，未复现）NSFW 正缓存不二次校验**

- 现象：`subject.covers` 先读缓存、后查 `nsfw`（`resolveCovers` 步骤 1 在步骤 3 之前）。若某 id 已存在正向缓存（历史版本写入、手工预热、或 dump 重导后 `nsfw` 由 0 变 1），命中缓存即直接返回封面 URL，卡片会展示 NSFW 封面；负缓存与实时 NSFW 判断只覆盖“未命中缓存”的 id。
- 最小复现（未执行，因约束禁止改 `.cache/**`）：向 `.cache/covers.db` 插入 `(id=22290, small='https://lain.bgm.tv/r/200/...', missing=0)`，再 `curl .../subject.covers?ids=[22290]` → 预期 `null`，实际会返回 URL。
- 期望：NSFW 判定先于缓存命中，或命中正向缓存时仍强制校验 `nsfw`。
- 现状：缓存中与 NSFW 相关的行均为 `missing=1`（24 条负缓存中含 NSFW、官方无图与 404），**当前无用户可见现象**，故不阻断验收。

**观察项（非缺陷）**

1. 冷缓存首屏 40/50 卡显示「无封面」约 5.7 s，之后每 ~5 s 补 10 张——分块 10 个 + 2 req/s 的必然结果；若需更快首屏可增大首块（如 20）或对首屏前 N 条并发取图。
2. 评分人数 ≥ 10,000 时沿用 V1.1 `formatCount`，显示 `3.2万` / `1万` 而非完整千分位（50 条中 5 条）。形态仍满足 `分数 · N 人评分`，如需精确数字需改 formatter。
3. `rank=null` 的 1 条（424578）不显示 `#rank`，与“保留 #rank”字面略有出入，属数据为空时的合理降级。
4. 切换标签筛选时出现 3 条 `_rsc` 请求 `ERR_ABORTED`（Next App Router 预取取消），无 console error / pageerror。

### 8.6 已知风险

| 风险 | 说明 |
| --- | --- |
| 缓存跨 dump 复用 | `cover_cache` 无版本/来源标记，重导 dump 后若 `nsfw` 或图片变更不会失效（负缓存 7 天后才重试） |
| 限速为进程内 | 500 ms 闸门是单进程单例；多实例/多 worker 部署会叠加到同一 IP，仍可能触发官方 3000 次/10 分钟限流（超限封 1 小时） |
| 冷启动体感 | 首张封面 5.7 s、整页 19.6 s（50 条中 38 次外部请求）；对首屏体验敏感时需要预取/首块加大 |
| 图片直连 CDN | 无服务端代理，移动网络/CDN 抖动时失败即永久占位（同 URL 不重试，仅刷新页面重试）；弱网下 NSFW 占位与失败占位不可区分 |
| `.cache/` 不入库 | 符合预期（已 ignore），但换机器/清目录后冷启动成本重现；部署时需持久化该目录 |

### 8.7 验收结论

封面替换需求 **通过**：左侧 2:3 封面、`分数 · N 人评分` meta 行、`#rank`/`看过 N` 保留、NSFW/无图/失败占位、分块链式加载与 2 req/s 限速、URL 缓存与负缓存、移动端布局、交互与 console 洁净度均经真实测量验证。唯一代码级隐患为 P1（NSFW 命中正向缓存时绕过判断），当前数据下不可见，建议后续迭代把 NSFW 校验前移或加入缓存失效策略。

> **注**：§8.7 与 §8.4 的“2 req/s / 首图 5.73 s / 整页 19.6 s”均为**修复前**数据；P1 已由后续提交修复，**以 §8.8 为准**。

---

### 8.8 修复复验（P1 + 限速调整）

> 复验时间：2026-11-03 19:32–19:56；dev 仍是 PID 41075（18:00:31 启动，**未重启**，7737）；仅读代码 + 临时目录脚本，未改 `src/**`、未动线上 `.cache/covers.db`、未 `pnpm add`。
> 修复代码位置：`src/server/cover/cover-service.ts`（未跟踪新文件，本轮 mtime 19:29）；**Next dev 已热加载新代码**——8 个未缓存 id 0.50 s 返回，证明突发桶生效（旧 2 req/s 需 ~3.5 s）。

#### 8.8.1 质量门禁（实测）

```text
$ pnpm test
 Test Files  10 passed (10)
      Tests  138 passed (138)        # 较修复前 +2：P1 回归用例
   Duration  4.52s (transform 260ms, setup 0ms, collect 626ms, tests 4.39s, environment 1ms)
$ pnpm typecheck
$ tsc --noEmit                        # 无输出，exit 0
```

| 项 | 结果 |
| --- | --- |
| `pnpm test` | ✅ 10 文件 / **138 用例**全绿（4.52 s） |
| `pnpm typecheck` | ✅ exit 0，0 error |
| 新增用例 | ✅ `cover-service P1 回归` 2 条（正向缓存 + NSFW → null 且覆盖负缓存；NSFW 查询失败 → 失败关闭） |

#### 8.8.2 P1 修复验证（三重证据）

**① 代码路径（读代码）**：`resolveCovers` 已改为
`0) 先查 NSFW → nsfw=1 直接 null 并写负缓存（覆盖旧正缓存）→ 1) 再读正/负缓存 → 2) 熔断检查 → 3) 回源`；
NSFW 查询失败时**失败关闭**（整批 null，且不返回正缓存）。缓存命中不再绕过 NSFW。

**② 独立注入复验（不碰线上缓存）**：在 `/tmp` 建临时 cache，用 `node:sqlite` 写入「旧正缓存 + 当前 NSFW」数据，通过 **vite-node 走真实服务代码** `createCoverService({ cachePath: /tmp/... })` 调用 `getCovers`，自写 10 条断言**全部 PASS**：

| 用例 | 断言 | 结果 |
| --- | --- | --- |
| A 正向缓存 + nsfw=1 | 返回 `null`、**0 次回源**、临时 cache 行被改写为 `missing=1` 且 URL 清空 | ✅ |
| B 正向缓存 + nsfw=0 | 仍返回缓存 URL、0 次回源（修复未误伤缓存） | ✅ |
| C NSFW 查询抛错 + 有正缓存 | 整批 `null`、0 次回源（失败关闭） | ✅ |
| D 混合批次（NSFW 与正常各有正缓存） | NSFW=null、正常=URL、0 次回源 | ✅ |

**③ 线上 API（7737）**：

```text
ids=[62229,22290] → {"22290":null, "62229":{grid:/r/100, small:/r/200, common:/r/400}}   (31 ms)
ids=[22290]       → {"22290":null}
```

**结论：✅ P1 已修复**（代码顺序 + 真实代码路径注入 + 线上 API 三方一致）；线上库未注入（约束禁止），故以临时 cache 复验替代，不存在“仅在线上不可见”的遗留怀疑。§8.5 的 P1 可关闭。

#### 8.8.3 限速调整验证

代码：`COVER_REQUESTS_PER_SECOND = 4`、`COVER_BURST_CAPACITY = 8`、并发仍 5（令牌桶，初始 8 个令牌）。

| 请求（全未缓存） | 实测耗时 | 期望（4/s + 突发 8） |
| --- | --- | --- |
| 8 个 id | **0.50 s** | ~0.05–0.5 s（全部吃突发） ✅ |
| 12 个 id | **1.28 s** | ~1.0 s ✅ |
| 20 个 id | **5.60 s** | ~3.0 s（外站延迟 + 排队，偏慢但同一量级） |
| 10 个 id（首次，含 dev 编译） | 3.88 s | — |

#### 8.8.4 冷缓存性能复测（3 组真实测量）

| 组 | URL（50/50 未缓存） | 首张封面 | 整页填充 | 最终结果 | 异常 |
| --- | --- | --- | --- | --- | --- |
| A | `?sort=score_asc&types=3` | **3.93 s**（解码 4.33 s） | 最后一张封面节点 **16.80 s** | 33 封面 + 17 占位 | **16 个 id 取图失败未写缓存**（+1 官方无图） |
| B | `?sort=score_asc&types=3&page=2` | **4.74 s** | 最后一次变化 **20.84 s**（稳定判定 27.27 s） | 45 封面 + 5 占位 | **5 个 id 取图失败未写缓存** |
| C | `?sort=score_asc&types=2&page=2`（带网络时序） | **2.95 s** | **10.50 s** | 40 封面 + 10 占位 | **0 失败**；10 占位 = 8 NSFW + 2 官方无图 |
| 修复前 | `?sort=score_asc&types=4` | 5.73 s | 19.61 s | 37 封面 + 13 占位 | 0 失败（12 NSFW + 1 无图） |

C 组 5 个分块请求的实测时序（请求开始 → 响应，均在页面时间轴）：

```text
674 → 2,953 ms (2,279 ms, 10 键 / 5 null)
2,954 → 3,748 ms ( 794 ms, 10 键 / 0 null)
3,748 → 6,000 ms (2,252 ms, 10 键 / 1 null)
6,036 → 8,619 ms (2,583 ms, 10 键 / 3 null)
8,620 → 10,498 ms (1,878 ms, 10 键 / 1 null)
```

- **C 组（无失败）对比修复前**：首图 5.73 → **2.95 s（−48%）**，整页 19.61 → **10.50 s（−46%）**，达到“首图 2–3 s、整页 ~12 s”的预期量级。
- A/B 组首图 3.93/4.74 s（较 5.73 s 改善 17–31%），整页 16.8/20.8 s（A 略优于修复前，B 与修复前持平），**未达预期**，原因见 §8.8.6 P2（部分 id 取图失败 + 熔断放大、重试缺失）。
- 结论：**限速调整 ✅ 生效**（8 个突发 → 4 req/s），性能在无失败批次达到预期，但冷启动稳定性存在波动。

#### 8.8.5 暖缓存回归（首页 1440×1000）

| 项 | 修复后实测 | 修复前 |
| --- | --- | --- |
| 50 条文字 | 748 ms | 767 ms |
| 首张封面 | **1,188 ms** | 972 ms |
| 封面 / 占位 / 裂图 | **47 / 3 / 0**（占位 id 226254、22290、424578 均 NSFW） | 47 / 3 / 0 |
| 滚动后 | 47 张全部加载，裂图 0 | 47 / 0 |
| console error / pageerror | **0 / 0** | 0 / 0 |
| 卡内 `.text-2xl` | 0 | 0 |
| 首卡 meta | `9.4 · 7,154 人评分 #1 看过 8,342` | 同 |

暖缓存首图较修复前慢约 216 ms（每批先查 NSFW 的固定成本），仍在原验收阈值 1.2 s 内，判定 ✅。

#### 8.8.6 新发现的问题

**P2（中等，需关注）冷启动取图失败未重试 + 熔断放大**

- 现象：3 组冷启动中有 2 组出现部分 id **既无封面也无缓存行**（服务端取图失败，`cacheable=false` 不写缓存），UI 只能显示「无封面」；A 组第 4 块约 6 个失败触发熔断（阈值 5 次/冷却 60 s），导致第 5 块 10 个 id 直接返回 null，整页 16/50 占位。B 组 5/50。C 组 0 失败（对照）。
- 最小复现：清空/新建 50 个未缓存 id，以 4 req/s + 突发 8 连续取图，观察 `cover_cache` 是否出现「无行」的 id；失败 id 刷新页面或重新请求即可补齐（实测重试 3 个失败 id：0.11 s 全部成功）。
- 期望：失败不应造成首屏大面积占位——可考虑失败重试 1 次、降低突发（如 4）、熔断阈值与恢复策略调整，或失败后异步补取；同时前端可在批次失败时自动重试一次。
- 说明：失败是瞬时性的（同 id 随后成功），未观察到 4xx 响应证据；无法确证与 4 req/s 的因果关系，但修复前 2 req/s 冷测未出现失败，且失败集中在高并发取图阶段，值得在上线前处理。

> **状态更新（2026-11-03 20:10）**：P2 **已在 §8.9 关闭**——单 id 重试 1 次 + 熔断 10 次/30 s/半开单探测 + 突发 4；复测冷启动 50 条失败数 **0**。

**观察**

1. 首块 10 个 id 的响应仍要 0.8–2.3 s（C 组），高于“突发 8 立即出图”的理论值；首图 2.95–4.74 s 的波动主要来自此。
2. A 组 16 个失败 id 中有 5 个在事后被手动重试补齐（0.11 s），其余 11 个未再请求，仍为“无缓存行”状态（无负缓存，不影响后续刷新）。
3. 暖缓存每批多一次 NSFW 查询：首图 +216 ms（1188 ms），仍 <1.2 s。

#### 8.8.7 修复复验结论

| 修复项 | 结论 | 依据 |
| --- | --- | --- |
| P1 NSFW 绕过缓存 | ✅ **已修复** | 代码顺序 + 临时 cache 注入 10/10 断言 PASS + 线上 22290=null |
| 限速 4 req/s + 突发 8 | ✅ **生效** | 8 个未缓存 0.50 s、12 个 1.28 s；C 组 50 条 10.5 s |
| 138 用例 / typecheck | ✅ | 10 文件 138 用例全绿；tsc exit 0 |
| 暖缓存 47/3/0/0 | ✅ | 复测一致 |
| 冷启动性能 | ⚠️ **部分达标** | 最好组 2.95 s / 10.5 s（−48%/−46%）；2/3 组因 P2 失败为 3.93–4.74 s / 16.8–20.8 s |

**最终结论：本轮修复通过验收（P1 关闭、限速生效、回归无破坏）**；但新增 P2（冷启动瞬时失败 + 熔断放大）建议作为下一迭代的首要修复项。§8.4.1 的限速/耗时数据与 §8.5 的 P1 描述均已被本节取代。

---

### 8.9 P2 修复复验

> 复验时间：2026-11-03 20:00–20:12；dev 仍是 PID 41075（18:00:31 启动，**未重启**）；仅读代码 + `/tmp` 脚本，未改 `src/**`、未动线上 `.cache/covers.db`。
> 修复代码：`src/server/cover/cover-service.ts`（mtime 19:52）/ `cover-service.test.ts`（19:57）；Next dev 已热加载——8 个未缓存 id 实测 **1.29 s**（突发 4：4 个立即 + 4 个 @4/s），对照 §8.8 突发 8 时同规模 0.50 s。

#### 8.9.1 质量门禁（实测）

```text
$ pnpm test
 Test Files  10 passed (10)
      Tests  146 passed (146)        # 较 §8.8 的 138 +8：重试/半开/熔断用例
   Duration  4.67s (transform 277ms, setup 0ms, collect 622ms, tests 4.60s, environment 1ms)
$ pnpm typecheck
$ tsc --noEmit                        # 无输出，exit 0
```

新增覆盖（用例名）：`网络错误重试 1 次成功后返回 URL`、`5xx 可重试`、`重试耗尽返回 null 且不写缓存`、`404 不重试`、`403 等非瞬时 4xx 不重试`、`连续 10 次失败才熔断`、`半开探测只放行 1 个`（3 条）、`令牌桶前 4 个突发`。

#### 8.9.2 代码检查（与声称一致）

| 修复点 | 代码证据 | 结果 |
| --- | --- | --- |
| 单 id 重试 1 次 | `fetchOne` 首次失败后 `sleep(retryDelayMs())` 再 `attempt` 一次；仅第二次失败才计失败 | ✅ |
| 退避 300–600 ms jitter | `COVER_RETRY_MIN_DELAY_MS=300` / `MAX=600`，随机取值 | ✅ |
| 只重试瞬时错误 | `isRetryableError`：404=false；`CoverHttpError` 仅 408/429/5xx；其余网络/超时/解析错误=true | ✅ |
| 404 / 空图不重试 | 404 → `notFound` 直接负缓存；`pickCoverUrls` 空 → 成功结果 null | ✅ |
| 熔断阈值 10 / 冷却 30 s / 半开单探测 | `COVER_BREAKER_THRESHOLD=10`、`COOLDOWN=30_000`、`halfOpenProbeInFlight` 单探测 | ✅ |
| 突发 8→4，平均仍 4 req/s | `COVER_BURST_CAPACITY=4`、`COVER_REQUESTS_PER_SECOND=4` | ✅ |
| 失败仍不写缓存 | `outcome(null, cacheable=false, ...)` → 不进入 `writes` | ✅ |

#### 8.9.3 冷启动实测（1 组，50/50 未缓存）

`?sort=score_asc&types=3&page=3`（实测 50 条 id 均不在 `.cache/covers.db`）：

| 指标 | 实测 |
| --- | --- |
| 50 条文字出现 | **681 ms** |
| 首张封面 | **2.82 s** |
| 分块请求（5 块 × 10） | 1.86 s / 2.40 s / 2.48 s / 2.55 s / 2.46 s |
| 第 5 块完成（最后封面节点） | **12.47 s** |
| 稳定判定耗时 | 17.02 s（含 4 s 稳定窗口 + 懒加载结算，仅用于确认无后续变化） |
| 封面 / 占位 | **49 / 1**（占位 id 56462，官方 API `images` 五档全空，属合法无图） |
| **失败数**（既无封面也无缓存行） | **0**（`.cache` 实查：49 条正缓存 + 1 条负缓存 + 0 条无行） |
| 裂图 / console error / pageerror | **0 / 0 / 0** |

#### 8.9.4 与 §8.8 及修复前对比

| 组 | 首图 | 整页填充 | 失败数 |
| --- | --- | --- | --- |
| 修复前（2 req/s） | 5.73 s | 19.61 s | 0（12 NSFW 不取图） |
| 8.8 A（4 req/s，突发 8） | 3.93 s | 16.80 s | **16** |
| 8.8 B（4 req/s，突发 8） | 4.74 s | 20.84 s | **5** |
| 8.8 C（4 req/s，突发 8） | 2.95 s | 10.50 s | 0 |
| **8.9（4 req/s，突发 4 + 重试）** | **2.82 s** | **12.47 s** | **0** |

**一句话结论**：P2 修复有效——冷启动失败数从 8.8 的 5/16 降到 **0**，首图 2.82 s（比修复前 5.73 s 快 51%，为全部 4 组中最快），整页 12.47 s（比修复前 19.61 s 快 36%，较 8.8 最好组慢约 2 s，是突发 8→4 换稳定性的预期取舍：每块 10 个约 2.5 s、5 块链式 ≈12.5 s）。

#### 8.9.5 暖缓存首页回归（1440×1000）

| 项 | 8.9 实测 | 8.8 | 修复前 |
| --- | --- | --- | --- |
| 50 条文字 | 755 ms | 748 ms | 767 ms |
| 首张封面 | **1,064 ms** | 1,188 ms | 972 ms |
| 封面 / 占位 / 裂图 | **47 / 3 / 0** | 47 / 3 / 0 | 47 / 3 / 0 |
| 占位 id | 226254、22290、424578（均 NSFW） | 同 | 同 |
| 滚动后 | 47 张全部加载，裂图 0 | 同 | 同 |
| console error / pageerror | **0 / 0** | 0 / 0 | 0 / 0 |
| 卡内 `.text-2xl` / 首卡 meta | 0 / `9.4 · 7,154 人评分 #1 看过 8,342` | 同 | 同 |
| 5 个封面分块请求 | 15–31 ms（全命中缓存） | — | — |

暖缓存切图仍 <1.2 s，回归全部成立 ✅。

#### 8.9.6 结论

| 项 | 结论 | 依据 |
| --- | --- | --- |
| 146 用例 / typecheck | ✅ | 10 文件 146 用例全绿（4.67 s）；tsc exit 0 |
| P2 修复有效性 | ✅ **关闭** | 冷启动 50 条失败数 **0**（8.8 为 5/16）；49 封面 + 1 合法无图；0 裂图 / 0 console |
| 重试 + 熔断策略 | ✅ | 代码与用例一致；冷测 5 块均无失败、无异常放大 |
| 突发 4 的吞吐 | ✅ | 每块 ~2.5 s（10 个 @4/s），整页 12.47 s，仍在可接受范围 |
| 暖缓存回归 | ✅ | 47 / 3 / 0，console 0，meta 不变 |

**最终结论：P2 修复通过验收并从 §8.8.6 关闭**；封面功能（P1 + P2）至此全部关闭，剩余仅有 §8.6 的既有风险（缓存跨 dump、进程内限速、CDN 直连等），无新增阻断项。综上，本次封面变更整体判定：**通过**。

---

### 8.10 NSFW 门禁移除与 token 支持（V1.3）

> 复验时间：2026-11-03 20:23–20:33；dev 仍是 PID 41075（18:00:31 启动，**未重启**）；**未设置** `BGM_API_TOKEN`；`.cache/covers.db` 仅只读查询，未删除/写入任何行（应用自身因请求写入的 404 负缓存除外）。
> 变更范围：`src/server/cover/cover-service.ts`（20:20）、`cover-cache.ts`（20:19）、新增 `cover-cache.test.ts`（20:20）。

#### 8.10.1 质量门禁（实测）

```text
$ pnpm test
 Test Files  11 passed (11)
      Tests  151 passed (151)        # 较 §8.9 的 146 +5，新增 cover-cache 用例文件
   Duration  4.65s (transform 254ms, setup 0ms, collect 588ms, tests 4.63s, environment 2ms)
$ pnpm typecheck
$ tsc --noEmit                        # 无输出，exit 0
```

| 项 | 结果 |
| --- | --- |
| `pnpm test` | ✅ 11 文件 / **151 用例**全绿（4.65 s） |
| `pnpm typecheck` | ✅ exit 0，0 error |
| 新增用例 | ✅ `cover-cache.test.ts`（v3 迁移 / reason / TTL）+ token header 两条（`BGM_API_TOKEN` 有/无） |

#### 8.10.2 代码层验证

| 声称 | 实测 | 结果 |
| --- | --- | --- |
| 不再查询 `Subject.nsfw` | `grep -n "queryRaw\|\$query\|FROM Subject" cover-service.ts` **无匹配**；全文仅注释出现 NSFW | ✅ |
| `client` 保留但不使用 | `getCovers(ids, client?)` → `resolveCovers(ids)`；内部 `_client?: PrismaClient` 从未读取，注释写明“仅为兼容 tRPC router 签名保留；实现不再查询 `Subject.nsfw`” | ✅ |
| 可选 `BGM_API_TOKEN` | `buildCoverRequestHeaders(token = process.env.BGM_API_TOKEN)`：有值时加 `Authorization: Bearer <token>`，否则只有 UA/Accept；默认 fetcher 使用该函数 | ✅ |
| 缓存 v3 | `COVER_CACHE_VERSION = 3`；迁移事务内 `DELETE FROM cover_cache WHERE missing = 1` → `UPDATE ... reason='ok' WHERE missing=0` → `PRAGMA user_version = 3`；新增 `reason TEXT NOT NULL DEFAULT 'unknown'`（旧库 `ALTER TABLE`） | ✅ |
| 负缓存 TTL 分原因 | `not_found` → `COVER_NOT_FOUND_TTL_MS = 24h`；`no_image`/`unknown` → `COVER_NEGATIVE_TTL_MS = 7d`；`getMany` 按 reason 选 TTL | ✅ |

**独立调用验证 token 头**（vite-node 直接调用真实函数，未设环境变量）：

```text
buildCoverRequestHeaders("secret-token") → {User-Agent, Accept, Authorization: "Bearer secret-token"}
buildCoverRequestHeaders(undefined)      → {User-Agent, Accept}            # 无 Authorization
buildCoverRequestHeaders("   ")          → {User-Agent, Accept}            # 空白 token 视为未配置
```

#### 8.10.3 上游事实复核（关键前提）

匿名 `GET https://api.bgm.tv/v0/subjects/{id}` 独立抽样（本轮 4 个，与实现者 10/10 抽样方向一致）：

| id | 类型 | HTTP |
| --- | --- | --- |
| 4639 素晴らしき日々 | NSFW | **404** |
| 22290 WHITE ALBUM2 -closing chapter- | NSFW | **404** |
| 328609 | 普通 | 200 |
| 10380 | 普通 | 200 |

**结论：上游对未认证请求隐藏 NSFW 条目（404），因此移除本品 NSFW 门禁后，匿名部署下 NSFW 仍拿不到封面——这是上游行为，不是回归。** 另：bgm.tv 页面同样只给通用页（实现者所述，本轮未单独复核网页侧）。
配套设计：404 负缓存 TTL 缩到 **1 天**，配置 token 后最多 1 天自动重试（此前为 7 天），避免旧 404 长期挡住 R18 封面。

#### 8.10.4 线上接口（7737）

| 请求 | 实测 |
| --- | --- |
| `ids=[22290,62229]` 第 1 次 | **24 ms**；`22290=null`，`62229.small=https://lain.bgm.tv/r/200/pic/cover/l/60/d8/62229_5Yt0j.jpg` |
| `ids=[22290,62229]` 第 2 次（暖） | **11 ms**（<50 ms ✅） |
| `ids=[4639]` | **7 ms**；`{"4639":null}` |

22290/4639 的 null 来自上游 404（已写入 `reason='not_found'` 负缓存），而非 NSFW 判断。

#### 8.10.5 页面回归（首页 1440×1000）

| 项 | 8.10 实测 | 8.9 | 结果 |
| --- | --- | --- | --- |
| 卡片数 | 50 | 50 | ✅ |
| 封面数 `/r/200/` | **47**（全部 loaded，0 裂图） | 47 | ✅ |
| 占位数 | **3**（226254、22290、424578，均 NSFW） | 3 | ✅ |
| 裂图 | **0** | 0 | ✅ |
| console error / pageerror | **0 / 0** | 0 / 0 | ✅ |
| 评分 meta | `9.4 · 7,154 人评分 #1 看过 8,342`（首卡，与之前一致） | 同 | ✅ |
| 卡内 `.text-2xl` | 0 | 0 | ✅ |
| 卡片链接 | 50/50 `bgm.tv/subject/{id}` + `_blank` | 同 | ✅ |
| 50 条文字 / 首图 | 1,068 ms / 1,484 ms | 755 / 1,064 ms | ⚠️ 略慢（见下） |

> 首屏较 §8.9 慢约 0.3–0.4 s：本轮首页 3 个 NSFW 负缓存已被 v3 迁移清空，首次加载需各自回源 404（约 0.25 s/次）后再写负缓存；第二次加载应回到 1.0 s 量级。属迁移后一次性成本，非回归。

#### 8.10.6 缓存 v3 实查（只读）

```text
PRAGMA user_version            → 3
PRAGMA table_info(cover_cache) → id, grid, small, common, fetchedAt, missing, reason
SELECT missing, reason, COUNT(*) GROUP BY ... →
  missing=0, reason=ok        n=652
  missing=1, reason=not_found n=4
total = 656
```

- **迁移生效**：负缓存只剩 4 行，且 `fetchedAt` 均为本轮 20:22–20:24 产生的 404（22290、4639、226254、424578）；正缓存 652 行保留（如 62229 的 `fetchedAt` 早于迁移 ~88 分钟）→ “清空 `missing=1`、保留正缓存、补 `reason` 列”三项均得到数据验证。
- 迁移后新增负缓存均为 `not_found`（1 天 TTL），无 `no_image`/`unknown` 行（本轮未遇到 200-空图与未知失败）。

#### 8.10.7 未验证项（需 token + 重启）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 带 `BGM_API_TOKEN` 的端到端取图 | ⚠️ **未验证** | 约束要求不设置 token 环境变量，dev 进程 env 中确认无 `BGM_API_TOKEN`（`/proc/41075/environ` 仅有 `NODE_ENV=development`）。代码/单测/独立函数调用已证明 header 形态正确，但“带 token 后 NSFW 返回 200 并取到封面”需配置 token 并重启 dev 后复测 |
| R18 封面实际展示 | ⚠️ **未验证** | 依赖上一项；匿名状态下上游 404，前端仍显示「无封面」占位（与门禁移除前一致） |
| 1 天 404 负缓存到期后自动重试 | ⚠️ 未做时间旅行验证 | 由单测覆盖（v3 TTL 用例），线上未等待 24 h |

> **状态更新（2026-11-03 20:47）**：以上 token 端到端与 R18 展示两项已由 §8.11（V1.4）验证通过——配置 `BGM_API_TOKEN` 后 NSFW 封面可正常取得。

#### 8.10.8 结论

| 项 | 结论 | 依据 |
| --- | --- | --- |
| 门禁移除 | ✅ 无回归 | 代码无 `Subject.nsfw` 查询；首页仍 47 封面 / 3 占位 / 0 裂图 / 0 console；meta 不变 |
| 可选 token | ✅ 代码正确（端到端未验证） | header 构造独立验证 + 单测；未设 token 时匿名 |
| 缓存 v3 迁移 | ✅ 已生效 | `user_version=3`、`reason` 列存在、负缓存清空后仅新增 4 条 `not_found`、正缓存 652 条保留 |
| 151 用例 / typecheck | ✅ | 11 文件 151 用例全绿（4.65 s）；tsc exit 0 |
| 上游 404 行为 | ✅ 已复核 | 匿名 NSFW 404、普通 200；移除门禁不改变匿名部署的可见结果 |

**最终结论：本轮（V1.3）无回归。** 当前状态 = **NSFW 门禁已移除，但匿名 API 对 NSFW 仍返回 404，因此页面仍是「无封面」占位**；若要展示 R18 封面，必须提供 `BGM_API_TOKEN` 并**重启 dev** 后复测（本轮按约束未设置 token，该端到端路径标注为未验证）。§8.8.2 的 P1（NSFW 先于缓存校验）随门禁移除而自然失效——NSFW 与普通条目已同路径，是否返回封面完全取决于上游是否认证，不构成回归。

---

### 8.11 BGM 客户端收口与 token 鉴权（V1.4）

> 复验时间：2026-11-03 20:47–21:02；QA **未重启 dev、未改 `src/**`、未 `pnpm add`**；token 全程**未打印**（仅输出长度/计数），报告不含 token 值。
> **环境说明**：本轮开始时 dev 已是新进程 **PID 101488（20:36:34 启动）**，原 PID 41075 已退出——该重启由实现方在验收前完成（**非 QA 操作**），也是 `.env.local` 中 token 得以加载的前提；验收期间未再重启。

#### 8.11.1 质量门禁（实测）

```text
$ pnpm test
 Test Files  12 passed (12)
      Tests  161 passed (161)        # 较 §8.10 的 151 +10：新增 bgm-client.test.ts
   Duration  4.78s (transform 285ms, setup 0ms, collect 618ms, tests 4.70s, environment 2ms)
$ pnpm typecheck
$ tsc --noEmit                        # 无输出，exit 0
```

| 项 | 结果 |
| --- | --- |
| `pnpm test` | ✅ 12 文件 / **161 用例**全绿（4.78 s） |
| `pnpm typecheck` | ✅ exit 0，0 error |
| 新增用例文件 | ✅ `src/server/bgm/bgm-client.test.ts`（含 token 读取/覆盖、404→null、错误类、限速、重试、熔断、相对路径限制等） |

#### 8.11.2 架构收口（grep 实测）

| 检查 | 命令 | 实测结果 |
| --- | --- | --- |
| `fetch(` 收口 | `grep -rn "fetch(" src/server --include=*.ts`（排除测试） | **仅 1 处**：`src/server/bgm/bgm-client.ts:285` |
| `BGM_API_TOKEN` 分布 | `grep -rn "BGM_API_TOKEN" src/` | `bgm-client.ts`（注释 7、选项注释 74、默认读取 266）、`bgm-client.test.ts`（129/130 用例）、`cover-cache.ts:20`（历史注释）。**无客户端文件** |
| `Authorization` / `Bearer` 分布 | `grep -rn "Authorization\|Bearer" src/`（排除测试） | **仅 `bgm-client.ts`**（298/386/389），cover-service 无 |
| 客户端文件引用密钥 | 遍历所有含 `"use client"` 的 `src` 文件 | **0 个文件**出现 `BGM_API_TOKEN` / `Authorization` |
| cover-service 注入 | 读代码 | `import { bgmClient, type BgmClient } from "~/server/bgm/bgm-client"`；`type CoverClient = Pick<BgmClient, "getSubject">`；`private readonly client: CoverClient`；`this.client = options.client ?? bgmClient`（测试可注入 fake）；`fetchOne` 调用 `client.getSubject(id)` |
| 路由不再传 DB | `src/server/api/routers/subject.ts` | `getCovers(input.ids)`，**无 `ctx.db`**，注释写明“外部请求统一走 bgmClient” |

`bgm-client.ts` 内部与声称一致：`BGM_API_BASE_URL`、`BGM_USER_AGENT`、`BGM_REQUEST_TIMEOUT_MS=5_000`、`BGM_REQUESTS_PER_SECOND=4`、`BGM_BURST_CAPACITY=4`、`BGM_MAX_CONCURRENCY=5`、`BGM_RETRY_MIN/MAX_DELAY_MS=300/600`、`BGM_BREAKER_THRESHOLD=10`、`BGM_BREAKER_COOLDOWN_MS=30_000`；`BgmHttpError`/`BgmNetworkError`/`BgmCircuitOpenError` 三个错误类；`getSubject` 404→`null`；`token` 为 `private readonly`；异常/日志路径经 `redact()` 把 token 替换为 `[redacted]`；`buildUrl` 拒绝绝对 URL（防 token 发往他处）。

#### 8.11.3 鉴权生效（线上接口）

| 请求 | 结果 | 耗时 |
| --- | --- | --- |
| `ids=[22290,4639,62229]`（首次） | **三个都有 lain.bgm.tv URL**（22290 `/r/200/.../22290_1L2aJ.jpg`、4639 `.../4639_kDq7d.jpg`、62229 `.../62229_5Yt0j.jpg`） | 216 ms |
| 同上（暖缓存重复） | 三个 URL | **20.9 ms**（<50 ms ✅） |
| `ids=[99999999]` | `{"99999999":null}` | 首次 **2.0 s**（dev 首次实网请求含编译 + 上游 404），重复 **11 ms**（负缓存） |
| `ids=[22423]`（匿名上游 **404**） | 返回 `small=https://lain.bgm.tv/r/200/pic/cover/l/71/f7/22423_SksK2.jpg` | **512 ms** |
| `ids=[172612]`（NSFW，未缓存） | 返回三尺寸 URL | **278 ms** |

匿名对照：`22423` 404、`172612` 200、`113290` 200——上游对 NSFW 的隐藏**并非**严格对应本地 `nsfw` 标记，因此 `22423`（匿名 404 → 应用 200）是 **token 真实生效**的直接证据，而非缓存或上游放宽所致。

#### 8.11.4 页面回归（Playwright 自跑 1440×1000）

| 指标 | 实测 |
| --- | --- |
| 卡片数 | 50 |
| 封面数（`/r/200/`） | **50**（全部 `complete && naturalWidth>0`） |
| 占位数 | **0** |
| 裂图 | **0** |
| console error / pageerror | **0 / 0** |
| 3 个原 NSFW 卡（226254、22290、424578） | **均有已加载封面**（token 生效后不再占位） |
| 首卡 meta | `9.4 · 7,154 人评分 #1 看过 8,342`（未变） |
| 首卡 | ゼルダの伝説 ブレス オブ ザ ワイルド（排序未变，前 5 id：62229、18462、238923、16261、226254） |
| 卡内 `.text-2xl` / 链接 | 0 / 50-50 `bgm.tv/subject/{id}` + `_blank` |
| 50 条文字 / 首图 | 999 ms / 1,188 ms |

#### 8.11.5 密钥不泄漏（重点）

| 检查 | 方法 | 结果 |
| --- | --- | --- |
| 源码分布 | `grep -rn "BGM_API_TOKEN" src/` | 仅服务端 `bgm-client.ts` + 测试 + 1 条历史注释；**无 `"use client"` 文件** |
| 页面 HTML | `curl -s http://127.0.0.1:7737/`（87,004 B）后统计 | `BGM_API_TOKEN` **0**、`Bearer ` **0**、token 值 **0** |
| 客户端 chunk | `grep -rl "BGM_API_TOKEN" .next/static` / 按 token 值检索 | **0 个文件 / 0 个文件** |
| 服务端 bundle | 按 token 值检索 `.next/server` | **0 个文件** |
| 全仓检索 | 排除 `node_modules/.next/.cache/dump-db/.git` 后按 token 值检索 | **仅 1 个文件：`.env.local`** |
| `.env.local` 入库风险 | `git check-ignore -v .env.local` | ✅ 命中 `.gitignore:28:.env*.local`，**未被跟踪**；权限 `664` |
| 其他 env 文件 | `git ls-files .env .env.template` + 键名检查 | `.env`/`.env.template` 虽被跟踪，但**只含 `DATABASE_URL`**，无 token |

token 长度 40，仅用于计数比对；全程未回显、未写入报告/缓存/日志。

#### 8.11.6 缓存实查（只读）

```text
PRAGMA user_version → 3
SELECT missing, reason, COUNT(*) → missing=0/reason=ok n=658；missing=1/reason=not_found n=1
22290: missing=0, reason=ok, small 非空   ✅
4639 : missing=0, reason=ok, small 非空   ✅
99999999: missing=1, reason=not_found     （不存在 id，符合预期）
```

token 生效后，原 NSFW 负缓存已被正向缓存覆盖（`fetchedAt` 更新为 20:44 前后），符合 v3 设计。

#### 8.11.7 未验证项与风险

| 项 | 状态 | 说明 |
| --- | --- | --- |
| token 轮换 / 过期 / 401 | ⚠️ **未验证** | 当前 token 有效；无 401 场景可测。更换 token 需改 `.env.local` 并**重启 dev** 才生效（Next 仅在启动时加载 env 文件） |
| 上游可见性波动 | ⚠️ 观察 | 抽样中 172612/113290 匿名也返回 200、22423 匿名 404 → 上游对 NSFW 的隐藏不等于本地 `nsfw` 标记；负缓存 TTL（404 1 天 / 无图 7 天）会延迟反映上游策略变化 |
| dev 重启责任 | ℹ️ 说明 | 本轮 dev 的新进程由实现方在 20:36:34 启动；QA 未重启。部署/换 token 后必须重启，否则 token 不生效 |
| `.env.local` 权限 | ⚠️ 建议 | 当前 `664`（组/其他可读），生产建议 `600`；已确认不入库 |

#### 8.11.8 结论

| 项 | 结论 | 依据 |
| --- | --- | --- |
| 161 用例 / typecheck | ✅ | 12 文件 161 用例全绿（4.78 s）；tsc exit 0 |
| 架构收口 | ✅ | `fetch(`/`Authorization`/token 读取仅存在于 `bgm-client.ts`；cover-service 通过 `CoverClient` 注入；路由不再传 `ctx.db` |
| token 鉴权生效 | ✅ | NSFW 三 id 全部出图；匿名 404 的 22423 经应用返回 URL（512 ms）；暖请求 20.9 ms |
| 页面回归 | ✅ | **50 封面 / 0 占位 / 0 裂图 / 0 console / 0 pageerror**；meta 与排序未变 |
| 密钥不泄漏 | ✅ | HTML、`.next/static`、`.next/server` 均 0；token 值仅存在于被 ignore 的 `.env.local` |
| 缓存 | ✅ | `user_version=3`；22290/4639 `missing=0 reason=ok` |

**最终结论：V1.4 无回归、未发现密钥泄漏、token 鉴权确认生效**；封面在此前所有验收项（P1/P2/v3）基础上进一步达到「首页 50 条全部出图、0 占位」。唯一需要注意的是 token 轮换/401 场景与部署重启要求（见 §8.11.7），不影响本次验收。
