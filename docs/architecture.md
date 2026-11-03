# BGM Filter · 技术架构与接口契约（V1）

> 需求见 `docs/requirements.md`。本文档是开发依据：数据模型、接口契约、目录结构、实现约束都以此为准。
> 技术栈：**T3 Stack** = Next.js（App Router）+ TypeScript + tRPC + Prisma + Tailwind CSS，包管理 **pnpm**。

## 1. 总体架构

```
dump-db/*.jsonlines ──(pnpm db:import，一次性)──▶ prisma/dev.db (SQLite)
                                                    │
Next.js App Router 页面 (/ 单页) ── tRPC ──▶ server/api/routers/subject ──▶ Prisma(只读) ──▶ SQLite
        │                                                 │
        └─ URL query 状态同步                     标签 DSL 解析/编译 → SQL
```

- 运行时不读取 JSONL，只读 SQLite；导入脚本与 Web 应用解耦。
- 前端不做本地过滤/排序，全部由服务端 SQL 完成（70 万条数据）。
- 无鉴权、无 NextAuth、无外部 API。

## 2. 版本与工程约定

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| next | `15.x` | App Router；不要用 16 |
| react / react-dom | `19.x` | 与 Next 15 匹配 |
| typescript | `5.x` | strict |
| @trpc/server / @trpc/client / @trpc/react-query | `11.x` | superjson transformer |
| @tanstack/react-query | `5.x` | tRPC v11 配套 |
| prisma / @prisma/client | `6.x` | SQLite provider；不要用 7 |
| zod | `3.x` | 输入校验 |
| tailwindcss + @tailwindcss/postcss | `4.x` | CSS-first 配置，`@import "tailwindcss";` |
| vitest | 最新 3.x | 单元测试 |
| superjson | `2.x` | tRPC transformer |

- 包管理只用 **pnpm**；命令用 `pnpm.cmd`（PowerShell 下 `.ps1` 被执行策略禁止）。根目录已有 `.npmrc` 把 store/cache 指到工作区内，勿改。
- `package.json` 增加：
  ```json
  "pnpm": {
    "onlyBuiltDependencies": ["@prisma/client", "@prisma/engines", "prisma", "esbuild", "sharp", "unrs-resolver"]
  }
  ```
- scripts 约定：
  ```json
  {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "db:generate": "prisma generate",
    "db:push": "prisma db push",
    "db:import": "node --env-file=.env scripts/import-dump.mjs"
  }
  ```
- `.env`（随仓库提交，无敏感信息）：
  ```
  DATABASE_URL="file:./dev.db"
  ```
  `prisma/schema.prisma` 与 `prisma/dev.db` 同目录，CLI 与运行时都能解析到 `prisma/dev.db`；若实测运行时路径不一致，以「`prisma/dev.db` 被正确打开」为准调整并在 `docs/data-report.md` 记录。
- 别名：`~/` → `src/`（tsconfig paths + Next 自动支持）。tRPC 用 T3 官方结构。

## 3. 目录结构（目标）

```
.
├─ .npmrc / .env / .gitignore
├─ package.json / pnpm-lock.yaml / tsconfig.json / next.config.ts / postcss.config.mjs
├─ prisma/
│  ├─ schema.prisma
│  └─ dev.db                # 由导入脚本生成，gitignore
├─ scripts/
│  ├─ import-dump.mjs       # JSONL → SQLite
│  └─ verify-db.mjs         # 导入后统计校验（可选，QA 用）
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx / globals.css / providers.tsx
│  │  ├─ page.tsx                    # 单页：筛选区 + 结果区
│  │  └─ api/trpc/[trpc]/route.ts
│  ├─ components/            # FilterPanel / TagExprInput / YearRangeInput / TypeFilter /
│  │                         # SortControls / ResultList / SubjectCard / Pagination / EmptyState ...
│  ├─ lib/
│  │  ├─ url-state.ts        # URL ↔ 筛选状态 的序列化/反序列化（纯函数，可测）
│  │  └─ format.ts           # 数字/年份/标签展示格式化
│  ├─ shared/
│  │  └─ subject-contract.ts # 前后端共享：类型、类型中文名、搜索输入 zod schema（契约单一来源）
│  ├─ server/
│  │  ├─ db.ts               # PrismaClient 单例
│  │  ├─ api/
│  │  │  ├─ trpc.ts          # initTRPC + superjson + 错误格式
│  │  │  ├─ root.ts          # appRouter
│  │  │  └─ routers/subject.ts
│  │  ├─ tag-dsl/
│  │  │  ├─ parser.ts        # 表达式 → AST（纯函数，无 IO）
│  │  │  ├─ compiler.ts      # AST → { sql, params }（纯函数）
│  │  │  └─ index.ts
│  │  ├─ search/
│  │  │  └─ subject-search.ts# 组装 WHERE/ORDER BY、执行查询、DTO 映射
│  │  ├─ bgm/
│  │  │  └─ bgm-client.ts    # 所有 Bangumi 外部请求的唯一入口（UA/Token/限速/重试/熔断）
│  │  └─ cover/
│  │     ├─ cover-service.ts # 封面 URL 解析（注入 BgmClient）+ 失败降级
│  │     └─ cover-cache.ts   # .cache/covers.db（node:sqlite，仅存 URL）
│  ├─ trpc/
│  │  ├─ react.tsx           # createTRPCReact
│  │  └─ server.ts           # RSC caller（可选）
│  └─ env.js                 # 可选，不强制
└─ docs/
   ├─ requirements.md / architecture.md
   ├─ data-report.md         # 数据导入报告（条目/标签/关联数、耗时、体积）
   └─ qa-report.md
```

## 4. 数据模型（Prisma，精确 schema）

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Subject {
  id           Int      @id
  type         Int      // 1漫画 2动画 3音乐 4游戏 6三次元
  name         String
  nameCn       String?
  date         String?  // 原始 "YYYY-MM-DD"，可能为 null
  year         Int?     // date 前 4 位数字；无效为 null
  score        Float    @default(0)   // 0 表示无评分
  scoreVotes   Int      @default(0)   // sum(score_details.values)
  rank         Int?     // 0 → null
  nsfw         Boolean  @default(false)
  favoriteJson String?  // JSON 字符串 {"wish":n,"done":n,"doing":n,"on_hold":n,"dropped":n}
  tagsJson     String?  // 用户标签 JSON: [{"name":"科幻","count":6}, ...]（最多 10 个，原顺序）
  metaTagsJson String?  // 公共标签 JSON: ["漫画","BL", ...]
  tags         SubjectTag[]

  @@index([type])
  @@index([year])
  @@index([score])
  @@index([type, score])
}

model Tag {
  id        Int    @id @default(autoincrement())
  name      String            // 规范展示名（大小写以出现次数最多的写法为准）
  nameLower String @unique    // name.toLowerCase()，DSL 匹配键
  count     Int    @default(0) // 含该标签的条目数（tags ∪ meta_tags）
  subjects  SubjectTag[]
}

model SubjectTag {
  subjectId Int
  tagId     Int
  subject   Subject @relation(fields: [subjectId], references: [id], onDelete: Cascade)
  tag       Tag     @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([subjectId, tagId])
  @@index([tagId, subjectId])
}
```

**导入规则（`scripts/import-dump.mjs`）**

1. 读取 `dump-db/subject.jsonlines`（`DUMP_DIR` 可覆盖目录），逐行 `JSON.parse`；坏行跳过并计数，不得中断。
2. 每行映射：
   - `id, type, name, name_cn → nameCn, date`；
   - `year = /^(\d{4})/.exec(date)?.[1] → Number`，无 date 或非法 → `null`；
   - `score = typeof score === number ? score : 0`；`scoreVotes = sum(Object.values(score_details ?? {}))`；
   - `rank = rank > 0 ? rank : null`；
   - `nsfw = Boolean(nsfw)`；
   - `favoriteJson = favorite ? JSON.stringify(favorite) : null`；
   - `tagsJson = JSON.stringify(tags ?? [])`（保留原样，最多取 10 个）；`metaTagsJson = JSON.stringify(meta_tags ?? [])`；
   - 标签集合 = `tags[].name ∪ meta_tags[]`，去重后建立 `Tag`（`nameLower` 唯一）与 `SubjectTag`。
3. 同一 `nameLower` 的大小写变体合并为一个 Tag：`count` 累加，`name` 取「累计出现次数最多的原始写法」（并列取字典序最小）。
4. 批量写入（每批 500–2000 行），导入前清空/重建三张表（幂等）。建议事务 + `PRAGMA journal_mode=WAL/synchronous=OFF` 加速，结束后恢复。
5. 结束后打印：`subjects / tags / subjectTags / 跳过行数 / 耗时 / dev.db 体积`，并写入 `docs/data-report.md`（可直接由脚本输出统计，人工整理）。
6. 导入脚本可用 `@prisma/client` 或 `node:sqlite`，但**最终表结构必须与上述 Prisma schema 完全一致**，且 `pnpm db:push` + `prisma generate` 后应用可正常查询。导入耗时目标 ≤ 5 分钟，DB ≤ 600 MB。

## 5. 标签 DSL 规格

### 5.1 词法

- 空白（含全角空格 U+3000）仅作分隔符，忽略。
- 运算符：`&`（且）、`|`（或）、`!` 与 `~`（取反）、`(`、`)`。
- 裸标签（bareTag）：连续字符，遇到空白 / `& | ( ) ! ~ "` 任一处终止。
- 引号标签（quotedTag）：`"` 开头，直到未转义的 `"`；内部 `\"` 表示 `"`、`\\` 表示 `\`，其它 `\x` 视为 `x`。引号内允许任意字符（含运算符与空白）。
- 标签名**不做**模糊/包含匹配，只做 `nameLower` 精确匹配（大小写不敏感）。

### 5.2 语法（优先级 低 → 高：`|` < `&` < `!`/`~`）

```
expr    := or
or      := and ( "|" and )*
and     := unary ( "&" unary )*
unary   := ("!" | "~") unary | primary
primary := "(" expr ")" | tag
tag     := quotedTag | bareTag
```

- 空字符串 / 纯空白 → `TagExpr { kind: "all" }`（不限制）。
- 允许冗余括号、连续取反（`!!科幻` 合法）。
- 错误类型（解析器需返回 `{ ok:false, message, position }`，`position` 为 0 基字符下标，前端 +1 展示）：
  - 未闭合括号（`科幻 & (恋爱`）→ 提示缺少 `)`，位置指向表达式末尾或 `(` 处；
  - 空括号 `()` / 悬空运算符（`科幻 &`、`| 科幻`、`(&)`）→「运算符缺少操作数」；
  - 未闭合引号 →「引号未闭合」；
  - 意外字符 →「无法识别的字符」。

### 5.3 求值（SQL 编译，`compiler.ts`）

- `compileTagExpr(ast)` 返回 `{ sql: string, params: unknown[] }`，用于生成 **subjectId 集合**的子查询：
  - 标签节点：`SELECT st."subjectId" AS id FROM "SubjectTag" st JOIN "Tag" t ON t."id" = st."tagId" WHERE t."nameLower" = ?`；
  - `NOT`：`SELECT s."id" AS id FROM "Subject" s EXCEPT (<inner>)`；
  - `AND`：`SELECT id FROM (<a>) INTERSECT SELECT id FROM (<b>)`；
  - `OR`：`SELECT id FROM (<a>) UNION SELECT id FROM (<b>)`；
  - 全部片段用括号包裹，参数按先左后右顺序拼接。
- 表达式中的标签（`parsedTags`）：解析器输出标签原文列表，服务端一次性 `Tag.findMany({ where: { nameLower: { in: lowerList } } })` 得到规范名与存在性；不存在的标签进入 `warnings`，不报错（对应集合为空）。
- 该编译器是**纯函数**，必须能在无 DB 环境下单测（用 `node:sqlite`/内存 SQLite 建 fixture 执行生成 SQL 亦可）。

## 6. 查询构造（`subject-search.ts`）

输入已校验的 `SearchInput`，输出结果 DTO。

**WHERE 组装（全部 AND）**

1. 标签：`s."id" IN (<compileTagExpr(ast).sql>)`；`ast.kind === "all"` 时省略。
2. 类型：`types` 为 undefined/空数组时省略，否则 `s."type" IN (?, ?, ...)`。
3. 年代：`s."year" >= ?` / `s."year" <= ?`（null 年份自然被排除）。
4. 名称：`(s."name" LIKE ? ESCAPE '\' OR s."nameCn" LIKE ? ESCAPE '\')`，参数 `%escaped%`（转义 `\ % _`）。

**ORDER BY**

- 无评分位置：
  - `last`：`(s."score" = 0) ASC`；
  - `first`：`(s."score" = 0) DESC`。
- `weighted_desc`（默认「综合评分」，贝叶斯加权）：
  `(s."score" * s."scoreVotes" + C * m) * 1.0 / (s."scoreVotes" + m) DESC` → `s."score" DESC` → `s."id" ASC`。
  - `C = SUM(score*scoreVotes)/SUM(scoreVotes)`（仅 `score > 0`；模块级缓存，dump 为静态数据，查询失败回退 7.1）；
  - `m = 50`；C / m 全部通过 `?` 参数传入，不拼接数值。
- `score_desc` / `score_asc`（原始评分）：`s."score" DESC|ASC` → `s."id" ASC`。
- 加权只作用于 `score > 0`；`score = 0` 由上面的分组单独排序，不参与加权。
- 参数拼接顺序：`WHERE` → `ORDER BY`（weighted 时为 `[C, m, m]`）→ `LIMIT/OFFSET`；`COUNT(*)` 不传 ORDER 参数。

**分页**：`LIMIT 50 OFFSET (page-1)*50`；先查 `COUNT(*)` 得到总数（同 WHERE），`totalPages = max(1, ceil(total/50))`，`page` 夹取到 `[1, totalPages]` 后重新计算 OFFSET。

**返回 items 的标签展示**：用一次额外查询取当前页 50 个 subjectId 的 `SubjectTag` + `Tag.name`（按 tagId）；卡片标签 = 用户标签（`tagsJson` 顺序）优先，不足 8 个用公共标签补，去重，最多 8 个。

**实现方式**：`prisma.$queryRawUnsafe`（SQLite 用 `?` 占位符）或 `Prisma.sql`；SQL 全部参数化，**严禁字符串拼入用户输入**（标签名只通过参数传入）。

## 7. tRPC 接口契约

`src/shared/subject-contract.ts`（前后端共享，单一来源）：

```ts
import { z } from "zod";

export const SUBJECT_TYPES = [
  { value: 1, label: "漫画" },
  { value: 2, label: "动画" },
  { value: 3, label: "音乐" },
  { value: 4, label: "游戏" },
  { value: 6, label: "三次元" },
] as const;

export const TYPE_LABEL: Record<number, string> = { 1: "漫画", 2: "动画", 3: "音乐", 4: "游戏", 6: "三次元" };

export const searchInputSchema = z.object({
  tagExpr: z.string().max(500).default(""),
  q: z.string().max(100).default(""),
  types: z.array(z.number().int()).optional(),          // undefined/[] → 全选
  yearFrom: z.number().int().min(1000).max(2100).nullable().optional(),
  yearTo: z.number().int().min(1000).max(2100).nullable().optional(),
  sort: z.enum(["weighted_desc", "score_desc", "score_asc"]).default("weighted_desc"),
  scoreless: z.enum(["last", "first"]).default("last"),
  page: z.number().int().min(1).default(1),
});
export type SearchInput = z.infer<typeof searchInputSchema>;

export interface SubjectCardDto {
  id: number;
  type: number;
  name: string;
  nameCn: string | null;
  date: string | null;
  year: number | null;
  score: number;        // 0 = 无评分
  scoreVotes: number;
  rank: number | null;
  nsfw: boolean;
  tags: string[];       // 展示用，最多 8 个
  favoriteDone: number; // 没有 favorite 时为 0
}

export interface SearchResultDto {
  items: SubjectCardDto[];
  total: number;
  page: number;
  pageSize: number;   // 固定 50
  totalPages: number;
  warnings: string[]; // 例如 ["未知标签：foo"]
  parsedTags: string[]; // 表达式中出现的已知标签规范名
}

export interface TagSuggestionDto {
  name: string;
  count: number;
}

export const PAGE_SIZE = 50;
```

`appRouter`：

```ts
export const appRouter = createTRPCRouter({
  subject: createTRPCRouter({
    /** 主搜索。输入解析错误 → TRPCError code "BAD_REQUEST"，message 为中文可读错误（含位置）。 */
    search: publicProcedure.input(searchInputSchema).query(async ({ input }) => { /* SearchResultDto */ }),

    /** 标签联想/常用标签。q 为空 → 按 count 倒序的常用标签。limit 默认 20，最大 50。 */
    tags: publicProcedure
      .input(z.object({ q: z.string().max(100).default(""), limit: z.number().int().min(1).max(50).default(20) }))
      .query(async ({ input }) => { /* TagSuggestionDto[] */ }),

    /** 头部统计：总条目、各类型条目数。 */
    stats: publicProcedure.query(async () => { /* {
      total: number;
      taggedTotal: number;
      types: { type: number; count: number }[];
    } */ }),
  }),
});
export type AppRouter = typeof appRouter;
```

约定：

- tRPC 使用 `superjson` transformer；错误格式允许默认 `message`。
- GET 查询可用 `/api/trpc/subject.search?input=<encodeURIComponent(JSON.stringify(input))>`（superjson 模式下也可用 `?batch=1&input=...`，QA 验证任一可用形式即可）。
- `tags` 查询：`q` 做 `nameLower LIKE %q%（转义）`，按 `count DESC, name ASC`。
- 页面数据流：`page.tsx` 为客户端组件（`"use client"`），用 `trpc.subject.search.useQuery(input, { keepPreviousData: true })`；`stats`/`tags` 用 `useQuery`。React Query 配置：`staleTime` 30s、`refetchOnWindowFocus: false`。

## 8. 前端页面规格

- 单页 `/`：顶部 Header（标题 + 统计）、筛选区（不吸顶、随页面滚动，含标签表达式、名称搜索、年份区间、类型多选、排序、无评分位置、重置按钮）、结果摘要（共 N 条 / 第 X/Y 页 / 警告）、结果列表（每页 50 行，非网格，窄屏卡片化）、分页器。
- 交互：筛选变化 → 300ms debounce → 更新 URL（`router.replace`，`scroll: false`）并重置 `page=1`；分页变化只改 `page`。放弃 `router.refresh` 式全页刷新。
- 组件边界：
  - `TagExprInput`：受控文本 + 解析状态占位 + 候选下拉 + 常用标签 chips + 点击插入到光标（用 `ref` 操作 `selectionStart`）→ 标签含空白/元字符时自动 `"..."` 包裹并转义 `\` `"`。
  - `YearRangeInput`：两个数字输入 + 校验（from > to 时红字且不查询）。
  - `TypeFilter`：复选框组，显示类型名与数量。
  - `SortControls`：评分排序切换 + 无评分位置切换。
  - `ResultList`/`SubjectCard`：按第 F8 条需求。
  - `Pagination`：首页/上一页/页码窗口/下一页/末页；按钮 aria-label。
  - `EmptyState`、`ErrorState`、`SkeletonRows`。
- URL 状态纯函数放 `src/lib/url-state.ts`：
  ```ts
  interface FilterState { tagExpr: string; q: string; types: number[]; yearFrom: number | null; yearTo: number | null; sort: "weighted_desc" | "score_desc" | "score_asc"; scoreless: "last" | "first"; page: number }
  parseFilterState(searchParams: URLSearchParams | Record<string, string | string[] | undefined>): FilterState
  toSearchParams(state: FilterState): URLSearchParams   // 默认值省略；types 用 "1,2,3,4,6"；page=1 省略
  ```
  需有 vitest 单测覆盖：默认值、逗号 types、非法参数回退、往返一致。
- 视觉：深色标题栏 + 浅色卡片，Tailwind 工具类；中文界面；无第三方 UI 库（不要装 shadcn/antd，保持依赖最小）。骨架/空态/错误态必须实现。
- 不使用 NextAuth、不使用 `next/image`（无图片）、不做 Server Actions。

## 9. 测试与质量

- `vitest`（node 环境）：
  - `parser` 单测：优先级、括号、取反、引号/转义、空表达式、各类错误 message+position；
  - `compiler` 单测：AND/OR/NOT 生成的 SQL 语义——用 `node:sqlite` 建内存 fixture（Subject/Tag/SubjectTag），执行生成 SQL 验证集合；
  - `url-state` 单测；
  - 若时间允许：`subject-search` 用临时 SQLite fixture 做集成测试（可选）。
- `pnpm typecheck`、`pnpm test`、`pnpm build` 必须通过（构建若被沙箱拦截，报告 Lead 用提权执行）。
- 手写 SQL 必须参数化；Prisma 原生查询结果需要显式 row 类型。

## 10. 已知坑位（务必规避）

1. **PowerShell 执行策略**：调用 `pnpm.cmd` / `npx.cmd`，不要用 `.ps1`。
2. **pnpm 10 构建脚本**：未列入 `onlyBuiltDependencies` 的依赖不会运行 postinstall；Prisma 必须先配置再 `pnpm install`，否则 `prisma generate` 可能缺引擎。
3. **沙箱限制**：只能写工作目录；不要设置全局 npm/pnpm 配置、不要把 store 指向工作区外；需要网络安装是允许的（registry 使用 `https://registry.npmmirror.com/`）。
4. **SQLite 路径**：`DATABASE_URL="file:./dev.db"` 相对 `prisma/` 目录；运行时若打开失败，用 `prisma/dev.db` 绝对路径验证并记录。
5. **Next 15 + React 19**：客户端组件用 `"use client"`；`searchParams` 在 App Router 中为 Promise（客户端用 `useSearchParams` 时注意 Suspense 边界，包一层 `<Suspense>`）。
6. **大 OFFSET**：页码夹取到 `totalPages`，避免请求超大 offset。
7. **标签名特殊字符**：DSL 只接受 `nameLower` 精确参数匹配，绝不拼接进 SQL；前端插入标签时自动加引号转义。
8. **中文编码**：JSONL 按 UTF-8 读取；Windows 终端乱码不影响文件内容。

## 11. 交付物

- 可运行代码（上述目录结构）、README（安装/导入/运行/命令）、`docs/data-report.md`、`docs/qa-report.md`。
- 验收以 `docs/requirements.md` 第 6 节清单为准。

## 12. 外部请求：`BgmClient`（V1.4）

所有对 Bangumi 的 HTTP 请求（当前为封面 URL 解析，后续的搜索/人物等）**必须**经由 `src/server/bgm/bgm-client.ts`，不得在业务模块里直接 `fetch`、自行拼 `Authorization` 或各建限速器。

```ts
const bgmClient = new BgmClient();          // 单例；测试可注入替身
bgmClient.getSubject(id);                    // 404 → null；返回 { id, name, name_cn, images }
bgmClient.request<T>(path, init?);           // 通用 JSON 请求，仅接受相对路径
```

- **鉴权**：`token` 默认取 `process.env.BGM_API_TOKEN`（写入 `.env.local`，已被 gitignore）；非空时加 `Authorization: Bearer <token>`，为空则匿名。Bangumi 匿名 API 对 `nsfw=true` 条目返回 404，配置令牌后返回 200。
- **超时/限速**：单请求 5s；令牌桶平均 4 req/s、突发 4、并发 5（官方 3000 次/10min，留 20% 余量）。
- **重试/熔断**：网络/超时/408/429/5xx 重试 1 次（300–600ms jitter）；连续 10 次失败打开熔断 30s，半开只放行 1 个探测；404 不重试。
- **错误模型**：`BgmHttpError(status, path)` / `BgmNetworkError(path)` / `BgmCircuitOpenError(path)`；确定性 4xx 不计入熔断。
- **安全**：token 为私有字段，异常与日志脱敏、不打印；仅接受相对路径以防令牌被发往其它主机；不得出现在任何 `"use client"` 模块或客户端 bundle。
- **封面**：`cover-service` 通过注入的 `BgmClient.getSubject` 取 URL，仅缓存 URL 到 `.cache/covers.db`（404 → `not_found` 1 天，200 空图 → `no_image` 7 天），图片由浏览器直连 `lain.bgm.tv`。
