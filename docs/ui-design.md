# BGM Filter · UI 交互设计稿（V1）

> 依据 `docs/requirements.md` §3、`docs/architecture.md` §8。实现时以本文档的布局层级与文案为准；与 requirements 冲突时以 requirements 为准。
> 目标：单页、纯本地、中文界面、无第三方 UI 库、窄屏可用。

## 1. 页面骨架（桌面 ≥1024px）

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Header（深色 slate-900 背景，sticky top-0 z-30）                          │
│  BGM Filter        共 700,108 条 · 有标签 422,912 条      [数据：2026-10-27]│
├──────────────────────────────────────────────────────────────────────────┤
│ FilterPanel（白色卡片，max-w-7xl，sticky top-14，z-20，shadow-sm）        │
│  标签表达式                                                              │
│  ┌────────────────────────────────────────────────────────────┐ [搜索]   │
│  │ 科幻 & (恋爱 | 百合) & !R18                                │          │
│  └────────────────────────────────────────────────────────────┘          │
│  ✅ 表达式合法 · 涉及 3 个标签        常用：漫画 游戏 PC 日本 R18 …      │
│  （非法时：⛔ 第 12 个字符附近缺少右括号）                                 │
│                                                                          │
│  名称搜索 [____________]   年代 [1990] — [2005]   类型 ☑漫画 ☑动画 …     │
│  排序 [综合评分] 评分从高到低  评分从低到高   无评分 [置底 ▾]   [重置筛选] │
├──────────────────────────────────────────────────────────────────────────┤
│ ResultSummary：共 1,234 条 · 第 1/25 页 · ⚠ 未知标签：foo   [清空标签]   │
├──────────────────────────────────────────────────────────────────────────┤
│ ResultList（每页 50 行，行间 1px 分隔，白底）                             │
│ ┌────┬──────────────────────────────────────────────────────────────┐   │
│ │8.7 │ 攻壳机动队 STAND ALONE COMPLEX            [动画] 2002-10-01   │   │
│ │★★★★│ 攻殻機動隊 STAND ALONE COMPLEX            #1933 · 看过 12,345 │   │
│ │1.2万│ 科幻 赛博朋克 押井守 神山健治 公安9课 士郎正宗 …（≤8，可点）  │   │
│ └────┴──────────────────────────────────────────────────────────────┘   │
│ … 49 more rows …                                                         │
├──────────────────────────────────────────────────────────────────────────┤
│ Pagination： [« 首页] [‹ 上一页]  1 … 4 5 [6] 7 8 … 25  [下一页 ›] [末页 »]│
└──────────────────────────────────────────────────────────────────────────┘
```

## 2. 组件规格

### 2.1 `Header`
- 深色 `bg-slate-900 text-slate-100`，高约 56px。
- 左侧标题「BGM Filter」+ 小字副标「Bangumi 条目筛选器」。
- 右侧统计（来自 `stats`）：`共 {total} 条 · 有标签 {taggedTotal} 条`；加载中显示 `…`，失败不阻塞页面。

### 2.2 `TagExprInput`（核心）
- 单行 input，`font-mono`，placeholder：`科幻 & (恋爱 | 百合) & !R18`。
- 实时解析（前端本地调用同一份 parser？——V1 允许前端仅做**轻量**校验或直接展示服务端返回；若前端不便复用，采用「输入后 300ms 由服务端 search 返回错误」的方式，但**解析状态区**必须在无请求时也能提示明显错误，如未闭合引号/括号的本地启发式）。**决策**：parser 用同构 TS 实现，放 `src/lib/tag-parse-lite.ts`，前端只做语法校验与标签名提取，不做求值；服务端 `src/server/tag-dsl/parser.ts` 为权威实现。两份需同构，单测各自覆盖。
- 状态行：
  - 合法：`text-emerald-600`，`✅ 表达式合法 · 涉及 N 个标签`。
  - 非法：`text-red-600`，`⛔ {message}（第 {position+1} 个字符附近）`，输入框 `ring-red-300`；**不打断输入、不发请求**。
  - 空表达式：`text-slate-500`，`未限制标签`。
- 候选下拉：输入 ≥1 字符且光标处于某个裸标签片段内时，调用 `subject.tags({q, limit:20})`，debounce 200ms；展示 `名称 · 12,345 条`；键盘 ↑↓ 选择、Enter 插入、Esc 关闭；点击插入。
- 常用标签 chips：`subject.tags({q:"", limit:12})`，点击追加。
- **插入规则**（`insertTag(expr, cursor, tag)` 纯函数，需单测）：
  - 若光标前一个非空白字符不是运算符/左括号且表达式非空 → 自动补 ` & `；
  - 标签名含空白或 `& | ( ) ! ~ "` → 包成 `"..."`，内部 `\` → `\\`、`"` → `\"`；
  - 若该标签已在表达式中（按 lower 比较）→ 不重复追加，仅聚焦；
  - 插入后光标落在新标签之后。

### 2.3 `YearRangeInput`
- 两个 `type="text" inputMode="numeric"`；placeholder `不限`。
- 非法（非整数、越界 1000–2100）：红字「年份需为 1000–2100 的整数」。
- `from > to`：红字「起始年不能大于结束年」，且**不发起查询**（保留上一次结果）。

### 2.4 `TypeFilter`
- 5 个 checkbox（漫画/动画/音乐/游戏/三次元），标签后显示计数，如 `动画 31,258`。
- 全不选 = 全选（URL 中写 `types=`? 不——按契约 undefined/[] 视为全选，URL 省略 types 表示全选；用户手动全取消时 URL 省略 types，UI 表现上恢复全选勾选，避免「取消后变全选」的认知冲突。**决策**：全取消时 UI 自动回填全选并提示一次「已恢复为全部类型」）。

### 2.5 `SortControls`
- 排序：三个分段按钮「综合评分」（默认）、「评分从高到低」、「评分从低到高」；「综合评分」旁 `?` 提示「按贝叶斯加权：评分 × 人数，弱化 1 人打 10 分的刷分效应」。
- 无评分：分段按钮「置底」「置顶」，旁边 `?` 提示「仅影响无评分条目，同组内按 ID 升序」。

### 2.6 `ResultSummary`
- `共 {total.toLocaleString()} 条 · 第 {page}/{totalPages} 页`；查询耗时 right-aligned 小字（可选）。
- `warnings` 逐条黄色提示：`⚠ 未知标签：foo`。
- 有标签条件时显示「清空标签」按钮。

### 2.7 `SubjectCard`（行式卡片）
- 左侧封面块：`aspect-[2/3]`，桌面宽 76px、移动宽 56px，`overflow-hidden rounded bg-slate-100`；`<img src={cover.small}>`（`lain.bgm.tv/r/200`）带 `loading="lazy"` `decoding="async"` `referrerPolicy="no-referrer"`；无封面 / `nsfw` / 加载失败 → 居中「无封面」灰块（保持 2:3，不产生 CLS）。
- 主区：
  - 第一行：`name`（`text-base font-medium truncate`，`title` 全文），右侧类型徽标（漫画=emerald、动画=sky、音乐=violet、游戏=amber、三次元=rose，浅底深字）+ 日期/年份。
  - 第二行：`nameCn`（若存在且 ≠ name，`text-sm text-slate-500 truncate`）+ 评分 `8.7 · 1.2万 人评分`（`font-medium tabular-nums`；无评分显示 `— 无评分`）+ `#rank` + `看过 {n}`。
  - 第三行：标签 chips（最多 8，`text-xs`，`bg-slate-100`，hover 变 `bg-slate-200`），点击追加表达式。
- 整卡 `<a href="https://bgm.tv/subject/{id}" target="_blank" rel="noreferrer">`；标签 chip 点击 `preventDefault` + `stopPropagation`。
- hover：`bg-slate-50`；窄屏（<640px）评分块移到顶部一行，卡片纵向排列。

### 2.8 `SkeletonRows`
- 50 行占位（可只渲染 10 行视觉重复），`animate-pulse`，高度与真实行一致（约 96px），避免跳动。

### 2.9 `EmptyState`
- 图标 + 「没有匹配的条目」+ 当前条件摘要（标签/年代/类型/搜索词）+ 三个按钮：`清空标签`、`放宽年代`、`取消名称搜索`（按当前生效条件显示）。

### 2.10 `ErrorState`
- 红色警示框 + 「加载失败：{message}」+ 若 message 含 database/表不存在 → 追加「数据库未导入？请先在终端运行 `pnpm db:import`」。
- 重试按钮。

### 2.11 `Pagination`
- 按钮：首页 «、上一页 ‹、页码窗口（当前 ±2，首尾固定显示，间隔用 `…`）、下一页 ›、末页 »。
- 当前页 `aria-current="page"`；禁用态 `opacity-40 cursor-not-allowed`。
- 页码点击 → 只改 `page`，滚动到结果区顶部（`scrollIntoView({behavior:"smooth"})`）。

## 3. 响应式
- `max-w-7xl mx-auto px-4`；筛选控件用 `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4`。
- <768px：筛选面板取消 sticky（避免占满屏），Header 统计省略「有标签」部分。

## 4. 状态与数据流

```
URL query ──parseFilterState──▶ FilterState ──(debounce 300ms)──▶ trpc.subject.search.useQuery
     ▲                                   │
     └──────── toSearchParams ◀──────────┘（page 变更立即写，不 debounce）
```
- 筛选条件变化：`page` 重置为 1，debounce 300ms 后 `router.replace(url, {scroll:false})`。
- 分页变化：立即写 URL。
- `useSearchParams` 必须在 `<Suspense>` 内；首屏用 URL 初始值渲染，避免闪烁。
- `keepPreviousData: true`，切换条件时保留旧列表 + 顶部细进度条（`isFetching`）。

## 5. 文案清单（中文，统一）
| 场景 | 文案 |
| --- | --- |
| 加载 | 骨架屏，无文案 |
| 空结果 | 没有匹配的条目 |
| 未知标签 | 未知标签：{name} |
| 语法错误 | 表达式有误：{message}（第 {n} 个字符附近） |
| DB 缺失 | 数据库未导入或不可读，请先运行 `pnpm db:import` |
| 重置 | 重置筛选 |
| 总数 | 共 {n} 条 |

## 6. 可访问性
- 所有输入有 `<label>`；按钮有 `aria-label`；分页当前页 `aria-current`；下拉候选 `role="listbox"`/`option`。
- 键盘可达：Tab 顺序 = 标签表达式 → 名称 → 起始年 → 结束年 → 类型 → 排序 → 结果 → 分页。
- 颜色对比 ≥ 4.5:1（slate-500 on white 用于次要文本，正文用 slate-700/900）。
