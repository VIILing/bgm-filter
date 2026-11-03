# BGM Filter

本地运行的 Bangumi 条目筛选工具：把 Bangumi Archive 的全量条目 dump 一次性导入本地 SQLite，然后在网页上按**标签表达式 + 年代 + 类型 + 名称**筛选，并按**评分**排序浏览结果。纯离线、无登录、无外部服务。

## 功能（V1）

- **多标签筛选（DSL）**：`&` 且、`|` 或、`!`/`~` 取反、`()` 分组，支持含空格/元字符的标签（`"C&C"`、`"K-ON!"`）；实时语法校验、错误位置提示、标签自动补全与常用标签。
- **年代筛选**：起始年/结束年，可与标签组合（AND）。
- **类型筛选**：漫画 / 动画 / 音乐 / 游戏 / 三次元，多选，显示各类型条目数。
- **名称搜索**：`name` / `name_cn` 子串匹配（转义 `%` `_`）。
- **评分排序**：高→低 / 低→高；无评分条目可置底（默认）或置顶。
- **分页**：每页 50 条，页码窗口 + 首页/末页，越界自动夹取。
- **URL 状态**：所有筛选条件写入 URL，刷新/复制链接可还原，支持浏览器前进后退。
- **结果卡片**：评分、评分人数、中/日文标题、类型徽标、日期、排名、「看过」数、最多 8 个可点击标签，整卡外链 bgm.tv。
- 骨架屏、空态（含放宽建议）、错误态（数据库缺失时提示导入命令）。

## 技术栈

T3 Stack：**Next.js 15**（App Router）+ **React 19** + **TypeScript** + **tRPC 11** + **Prisma 6**（SQLite）+ **Tailwind CSS 4**；测试 **Vitest 3**；包管理 **pnpm**。

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 生成 Prisma Client 并建表
pnpm db:generate
pnpm db:push

# 3. 准备数据（首次）
#    下载并解压到 dump-db/，确保 dump-db/subject.jsonlines 存在
#    https://github.com/bangumi/Archive/releases/tag/archive
pnpm db:import          # 约 20 秒，生成 prisma/dev.db（311.8 MB）

# 4. 启动
pnpm dev                # http://localhost:3000
```

> `dump-db/`（约 1.9 GB）与 `prisma/dev.db` 已在 `.gitignore` 中，不会提交。
> 环境变量 `DUMP_DIR` 可覆盖 dump 目录（默认 `dump-db`）。

## 命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 开发服务器（3000） |
| `pnpm build` / `pnpm start` | 生产构建 / 启动 |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest（DSL、编译 SQL、URL 状态、标签插入、真实数据集成测试） |
| `pnpm db:generate` | `prisma generate` |
| `pnpm db:push` | 建表（不改数据） |
| `pnpm db:import` | JSONL → SQLite，幂等，结束时打印统计并写入 `docs/data-report.md` |

## 标签表达式语法

```
expr    := or
or      := and ( "|" and )*
and     := unary ( "&" unary )*
unary   := ("!" | "~") unary | primary
primary := "(" expr ")" | tag
```

- 优先级：`!`/`~` > `&` > `|`；空表达式 = 不限制标签。
- 标签名含空白或 `& | ( ) ! ~ "` 时用双引号包裹，引号内支持 `\"` 与 `\\`。
- 示例：`科幻 & (恋爱 | 百合) & !R18`、`"C&C" | "D&D"`、`"K-ON!"`。

## 数据

数据源：[bangumi/Archive](https://github.com/bangumi/Archive) 的 `subject.jsonlines`（本次为 `dump-2026-10-27`）。字段与本次实测：

| 项 | 值 |
| --- | --- |
| 条目总数 | 700,108 |
| 类型分布 | 漫画 422,971 / 动画 31,258 / 音乐 101,230 / 游戏 117,881 / 三次元 26,768 |
| 有标签条目 | 422,912（标签去重 91,909） |
| 标签关联 | 2,267,357（Σ 每条目 `tags ∪ meta_tags` 去重） |
| 有评分 / 无日期 | 287,448 / 53,871 |
| 导入耗时 / DB 体积 | 19.5 s / 311.8 MB |

> 注：`docs/requirements.md` 早期版本预估「约 500 万标签关联」有误；dump 中 `tags` 数组实际均值约 2.8 个，实测与独立扫描一致为 2,267,357，详见 `docs/data-report.md`。

## 目录结构

```
src/
├─ app/                  # 单页 + tRPC route handler
├─ components/           # FilterPanel / TagExprInput / ResultList / Pagination ...
├─ lib/                  # url-state、tag-insert、tag-parse-lite、format（纯函数 + 单测）
├─ server/
│  ├─ api/               # tRPC 初始化、root router、subject router
│  ├─ tag-dsl/           # 标签表达式 parser / compiler（纯函数 + 单测）
│  └─ search/            # SQL 组装、执行、DTO 映射（含真实数据集成测试）
└─ shared/               # 前后端共享契约（zod schema + DTO 类型）
scripts/                 # import-dump.mjs（导入）、verify-db.mjs（校验）
prisma/                  # schema.prisma + dev.db（生成物）
docs/                    # 需求、架构、UI 设计、数据报告、QA 报告
```

## 测试与验收

- 单元测试：DSL 解析（优先级/括号/取反/引号/错误位置）、SQL 编译语义（内存 SQLite 执行验证）、URL 状态往返、标签插入转义。
- 集成测试：真实 `prisma/dev.db` 上验证计数、子集关系、年份/类型过滤、排序、分页夹取、unknown tag 警告；无 DB 时自动跳过。
- 验收结论见 `docs/qa-report.md`，数据导入证据见 `docs/data-report.md`。

## 已知限制（V1 非目标）

- 无登录/多用户/云端部署；无详情页、封面、评论、评分分布图。
- 不按排名/日期排序，不按 `meta_tags` 单独筛选，不支持结果导出。
- 名称搜索为 `LIKE '%x%'` 全表扫描（约 40–100 ms），未做全文索引。
- 结果卡片最多展示 8 个标签，因此个别结果的命中标签可能不在卡片上（过滤仍按全量标签语义执行）。
