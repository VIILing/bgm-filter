# Round 4 · 条目点击弹窗（V3）· QA 独立验收报告

> 验收对象：`docs/round4-requirements.md`、`docs/round4-ui-spec.md`、`docs/ui-design.md` §2.13（V3）；内部布局沿用 §2.12（V2）。
> 验收方式：真实 `prisma/dev.db`（700,108 条）+ 真实 Bangumi 封面 + 独立 Chromium（Playwright）。QA 未修改任何业务代码/测试代码/设计文档。
> 验收时间：2026-11-04。执行基线：Round 4 最终实现（`SubjectDialog` + `ResultList` 点击弹窗）。

## 1. 结论

**通过。当前无 P0/P1 缺陷；P2 仅 1 条非阻塞动效观察（见 §2 D14），无阻塞项。**

| 项 | 数量 | 说明 |
| --- | --- | --- |
| P0 | 0 | — |
| P1 | 0 | 未发现 |
| P2 | 1 | 非阻塞：打开动画中途关闭时产生一次视觉闪跳（D14 / P2-01）；双击等其余观察见 §4 |

质量门禁：

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 单元 + 真实数据集成 | `TMPDIR=$PWD/.tmp pnpm test` | **15 files / 207 tests passed**，9.54 s |
| 类型 | `pnpm typecheck` | **0 error** |
| 构建 | `TMPDIR=$PWD/.tmp pnpm build` | **通过**；`/` 29.5 kB / First Load 159 kB |
| E2E | `TMPDIR=$PWD/.tmp PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers pnpm test:e2e` | **17 passed**，31.1 s |

环境：Node v27.0.0-alpha / pnpm 12.16.1；Chromium 1248（`.playwright-browsers`）；dev/prod 8004；`TMPDIR=$PWD/.tmp`；真实数据 `Subject=700,108`。

## 2. 逐条验收结果

### A. 打开与触发

#### A1 4 档点击打开、严格居中、内部布局不变 — 通过

实测（`getBoundingClientRect`，DPR=1，headless 覆盖式滚动条）：

| 视口 | 面板 bbox（中心） | 上区高 | 封面槽 | 右栏 | 简介可视高 | 按钮 bbox | 间距 | 右缘余量 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1440×900 | 880×820 @ (280,40)，中心 (720,450) | 426.39 | 300×426.39 | 506 | 280.61 | 56×56 @ (1180,40) | 20 | 204 |
| 1280×900 | 880×820 @ (200,40)，中心 (640,450) | 426.39 | 300×426.39 | 506 | 280.61 | 56×56 @ (1100,40) | 20 | 124 |
| 1024×900 | 848×820 @ (88,40)，中心 (512,450) | 426.39 | 288×426.39 | 498 | 288.61 | 56×56 @ (952,40) | 16 | 16 |
| 768×900 | 592×820 @ (88,40)，中心 (384,450) | 426.39 | 208×426.39 | 334 | 296.61 | 56×56 @ (696,40) | 16 | 16 |

- 面板水平、垂直均严格居中；900 高时 top=40，面板压住 Header 底部 16px，属用户确认取舍。
- 内部布局与 Round 3 V2 一致：1440 内边距 24 / 封面 300 / 右栏 506；1024 内边距 20 / 封面 288 / 右栏 498；768 内边距 16 / 封面 208 / 右栏 334；标题/元信息/标签/简介结构未改。
- 所有视口 `documentElement.scrollWidth === innerWidth`，无横向溢出；按钮右缘 + 16 ≤ 视口宽。
- 证据：`round4-qa-1440x900.png`、`round4-qa-1280x900.png`、`round4-qa-1024x900.png`、`round4-qa-768x900.png`。

#### A2 悬浮 3 条不出现面板、不发预览/原图请求 — 通过

- 页面封面分块完成后，依次悬浮 3 行（每行约 400ms，再等 1s）：
  - 面板/弹窗 count = 0；
  - `subject.preview` / `subject.summary` / 原图请求 = **0**；
  - 行只显示 hover 背景高亮（computed `oklch(0.984 0.003 247.858)`，即 slate-50）。
- 证据：`round4-qa-hover-only.png`；网络记录见 §5。

#### A3 行内标签 chip 仍追加筛选，不打开弹窗 — 通过

- 点击第 1 行「任天堂」chip：弹窗 count=0；标签输入框值「任天堂」；URL `?tag=%E4%BB%BB%E5%A4%A9%E5%A0%82`；结果总数 701 条。
- 证据：`round4-qa-tag-chip.png`。

#### A4 键盘 Enter/Space、Esc、焦点返回、Tab 圈闭、role/aria — 通过

- 触发行 `aria-haspopup="dialog"`；焦点行按 Enter / Space 均只打开 1 个弹窗。
- 打开后焦点在 dialog 容器；`role="dialog"`、`aria-modal="true"`；`aria-labelledby` 指向面板内 h3（实际标题文本可解析）；`aria-describedby` 指向 sr-only「按 Esc 或右键任意处关闭」。
- Tab 序列实测：dialog → 标签滚动区 → 简介滚动区 → BGM 按钮 → 标签滚动区；Shift+Tab 从标签区回 BGM，从 dialog 回 BGM；焦点始终在 dialog 内。
- 打开时 `main` 处于 `[inert]`，html/body `overflow:hidden`；Esc 后面板卸载、焦点回到触发行（`data-subject-trigger`）、背景解除 inert、body/html 恢复 `visible`。
- 关闭动画另见 C10。
- 证据：数据记录（临时 Playwright 脚本已删除）；截图同视口截图。

### B. 独立 BGM 按钮

#### B5 4 档按钮均 56×56、顶边=面板顶边、间距 20/16、无溢出 — 通过

| 视口 | 按钮 bbox | 顶边 | 面板顶边 | 间距 | 按钮右缘 | 视口余量 |
| --- | --- | --- | --- | --- | --- | --- |
| 1440×900 | (1180,40,56,56) | 40 | 40 | 20 | 1236 | 204 |
| 1280×900 | (1100,40,56,56) | 40 | 40 | 20 | 1156 | 124 |
| 1024×900 | (952,40,56,56) | 40 | 40 | 16 | 1008 | 16 |
| 768×900 | (696,40,56,56) | 40 | 40 | 16 | 752 | 16 |

- 统一 56×56，不是宽按钮；按钮为独立 `position:absolute; left:100%; top:0`，不参与面板宽度/内部列宽。
- 1024/768 下 `88 + 面板 + 16 + 56 + 16 = 视口宽`，恰好放下；无横向滚动条。
- 截图：4 张视口截图；按钮内容为外链图标 + 「BGM」。

#### B6 点击按钮打开 bgm.tv、弹窗保持；右键按钮关闭 — 通过

- 1440/1024/768 点击按钮均捕获 popup，URL=`https://bgm.tv/subject/62229`；弹窗 count 保持 1，标题/内容不变。
- 右键按钮：弹窗关闭；`contextmenu` 事件 `defaultPrevented=true`；焦点回到触发行。
- 证据：`round4-qa-1440x900.png`、`round4-qa-1024x900.png`、`round4-qa-768x900.png`；详细数据见验收脚本输出。

### C. 遮罩与关闭

#### C7 遮罩覆盖全屏、颜色/blur、背景 inert、body 锁定 — 通过

- 遮罩 bbox = (0,0,视口宽,视口高)；computed `background-color: rgba(15,23,42,0.22)`、`backdrop-filter: blur(2px)`、`z-index:100`；面板 z=101、按钮 z=102。
- 打开时 `main` 的祖先为 `[inert]`；html/body overflow 均为 hidden；body padding-right 在 headless 为 0（无经典滚动条）。
- 页面滚动锁定：在 scrollY=500 打开 → y 保持 500；面板外滚轮 700 → y 仍 500；简介内部滚轮到 `st=205` → y 仍 500；关闭后 y 仍 500；关闭后滚轮 700 → y=1200。
- 证据：`round4-qa-1440x900.png`、`round4-qa-longsummary.png`。

#### C8 右键任意位置 / Esc / 左键遮罩关闭，contextmenu 被阻止 — 通过

- 右键面板、按钮、遮罩、面板文字、简介滚动条：弹窗均关闭；`contextmenu` 事件均 `defaultPrevented=true`。
- Esc：关闭；左键点遮罩空白 (50,500)：关闭；点底部提示（`pointer-events:none`，命中遮罩）：关闭。
- 右缘/按钮/面板等所有测试点均关闭；无原生右键菜单（headless 无法显示菜单，但事件已 prevented）。
- 证据：数据记录；截图同视口。

#### C9 点面板/按钮不关闭；pointerdown 面板 + pointerup 遮罩不关闭 — 通过

- 点面板标题、封面占位、简介、标签 span：弹窗 count 均保持 1。
- 点按钮左键：popup 打开、弹窗保持 1。
- 指针从面板按下、拖到遮罩松开：弹窗保持 1；反向（遮罩按下、面板松开）后再面板按下/遮罩松开也未关闭（实测 count=1）。
- 底部提示左键点击走遮罩关闭（提示 `pointer-events:none`）。
- 证据：数据记录；截图同视口。

#### C10 关闭动画约 150ms、reduced-motion、焦点/滚动恢复 — 通过

- 正常关闭（production）：面板 `pop-out + fade-out`、遮罩/按钮 `fade-out` 均 **140ms ease-in**；150ms timer 于 150.9ms 触发，MutationObserver 实测 Esc → dialog 移除 **157.1ms**（含事件调度）。
- `prefers-reduced-motion: reduce`：animation `none`、transform `none`；timer 0ms（实测 9.5ms 调度）、dialog 移除 **14.3ms**，无缩放/位移/回弹/延迟。
- Esc/遮罩/右键关闭后焦点均回触发行；滚动位置恢复（500→500）；body/html overflow 恢复，背景解除 inert。
- 打开中途关闭的视觉闪跳见 D14 / P2-01。
- 证据：数据记录；`round4-qa-anim-open.png`、`round4-qa-anim-interrupt.png`。

### D. 状态与回归

#### D11 加载/失败/无封面/重复打开/方形封面 — 通过

| 场景 | 结果 |
| --- | --- |
| 原图加载中（延迟 2.2s） | 面板 880×820；占位 284.27×426.39（pulse 可见）；img 0×0/opacity 0；标题/标签先显示；加载后 img 262.64×426.38、opacity 1；面板/槽 bbox 完全相同 |
| 预览接口失败 | 「标签 0 / 预览加载失败」+「暂无简介」；封面正常；面板 880×820 |
| large 失败 | 自动回退 `/r/400/...`（400×649 → 262.8×426.38），opacity 1；占位 opacity 0 |
| 全部图片失败 | 无 img；占位 284.27×426.39、opacity 1、显示「无封面」；面板 880×820 |
| 真实无封面 id 444549 | 无 img；「无封面」；10.0/1 人评分；标签 0 + 公共标签 PC/游戏；简介正常 |
| 同一条目打开 5 次 | 第 1 次原图请求 1，后续 0；5 次 img opacity 均 1、占位均 0；面板恒 880×820（P1 不回退） |
| 方形封面 (`さくら、もゆ` 第 1 条) | 原图 500×500 → 显示 300×300；加载后占位 opacity 0；槽背景透明；无灰底（P2-02 不回退）；简介 sh=2475 可内部滚 |

- 证据：`round4-qa-loading.png`、`round4-qa-preview-fail.png`、`round4-qa-fallback.png`、`round4-qa-all-fail.png`、`round4-qa-no-cover.png`、`round4-qa-square.png`。

#### D12 内部滚动、resize、767/触屏 — 通过

- 长简介 `Yes, Minister (Series 3)`：`ch=281 / sh=376`；滚到底 `st=95`，页面 `scrollY` 保持 300。
- resize 1440→1024：面板 848×820 @ (88,40)，按钮 (952,40)，封面槽 288、右栏 498；resize 1024→768：面板 592×820 @ (88,40)，按钮 (696,40)；均保持打开。
- resize <768（767）：自动关闭；body/html overflow 恢复；焦点回触发行；背景解除 inert。
- 767：触发行无 `aria-haspopup`；点击打开 popup `https://bgm.tv/subject/62229`，无弹窗。
- 触屏上下文（`hasTouch:true`，1440）：`(hover:hover)=false`、`(pointer:fine)=false`；点击打开 popup，无弹窗。
- 证据：`round4-qa-767x900.png`、`round4-qa-touch.png`、`round4-qa-longsummary.png`。

#### D13 筛选/搜索/类型/年代/排序/分页/URL/行内封面回归 — 通过（全程无 hover 预览）

- 初始：50 行、700,108 条、首行 Zelda（9.4，#1）。
- 非法标签 `科幻 &&`：红字「运算符 "&" 缺少操作数（第 4 个字符附近）」、暂停查询、保留旧结果、无弹窗。
- 合法 `科幻`：7,331 条；`q=攻壳`：41 条；仅动画：31,258；2000–2010：122,392。
- 评分高→低首行 10.0；低→高首行 1.0；无评分置顶首行「— 无评分」；恢复综合评分/置底回到 Zelda。
- 第 2 页 `?page=2` 50 行；直接 URL `tag=科幻&types=2&from=2000&to=2010&sort=score_desc&scoreless=first&page=2` 全部还原（476 条）；非法 URL 回退默认（700,108，URL `/`）。
- 行封面：等待加载后前 10 行均 `/r/200`、76×114（2:3）、`docSW=1440`；无横向溢出。
- 全程 `subject.preview` / `subject.summary` / 原图请求 0，弹窗 0。
- 证据：`round4-qa-regression.png`、`round4-qa-list.png`。

#### D14 弹性 pop 动效补充验收（2026-11-05）— 通过（P2 观察 1）

**打开动画**（Chromium 1248，WAAPI pause/seek；DPR=1）：

- computed：
  - 面板 `subject-dialog-pop-in, subject-dialog-fade-in`；duration `0.22s, 0.16s`；timing `cubic-bezier(0.34, 1.56, 0.64, 1), ease-out`；delay `0s, 0s`；fill `both, both`；
  - 遮罩 `subject-dialog-fade-in`，0.18s ease-out；
  - BGM 按钮 `subject-dialog-jump-in, subject-dialog-fade-in`，0.22s/0.22s，delay **0.025s**（25ms，规格允许 20–30ms）。
- transform 采样（`DOMMatrix` m11/m42；CSS keyframe 为 `scale(0.92) translateY(6px)`，矩阵 ty=5.52 是 6×0.92，不是规格偏差）：

| 时间 | scale | translateY | panel opacity | overlay opacity | jump opacity |
| --- | --- | --- | --- | --- | --- |
| 0ms | 0.92000 | 5.520 | 0 | 0 | 0（delay 中） |
| 80ms | 0.99952 | 0.036 | 0.6846 | 0.6230 | 0.3781 |
| 120ms | **1.00772** | −0.583 | 0.9065 | 0.8438 | 0.6084 |
| 160ms | 1.00538 | −0.406 | **1** | 0.9792 | 0.7977 |
| 220ms | 1.00000 | 0 | 1 | 1 | 0.9783 |
| 240ms | 1.00000 | 0 | 1 | 1 | 0.9990 |
| 244ms | 1.00000 | 0 | 1 | 1 | 0.99996 |

- 实际播放确认：`animationName/duration/easing/delay/fill` 均非终态直出；120ms 峰值 scale **1.00772 > 1**，220ms 归 1，符合弹性 pop。
- 120ms 中点帧：`offsetWidth/Height=880/820`，bbox 886.79×826.33（transform 视觉放大），最终 bbox **880×820 @ (280,40)**；`scrollWidth=1440`，无横向滚动；`layout-shift` 归零后打开/关闭 CLS=**0**。
- 证据：`round4-qa-anim-open.png`（120ms 暂停帧）。

**关闭动画**（production）：

- 面板 `subject-dialog-pop-out, subject-dialog-fade-out`，0.14s/0.14s `ease-in both`；遮罩/按钮 0.14s `ease-in`；进度实测 opacity 0.976→0.8235→0.426，140ms 到 0/scale 0.97。
- 150ms timer 于 150.9ms 触发，Esc→DOM 移除 **157.1ms**；卸载后 focus 回触发行、body overflow 恢复；无残影。
- reduced-motion：computed animation `none`、transform `none`、opacity 1；timer 0ms、DOM 移除 **14.3ms**，焦点/滚动锁仍即时生效。

**中途关闭观察（P2-01，非阻塞）**：

- 打开至约 40ms（opening currentTime 33–50ms）按 Esc：before `scale=0.98147 / ty=1.364 / opacity=0.462`；下一帧 close 动画从 keyframe 起点 `scale=1 / ty=0 / opacity=1` 开始，视觉上先跳到终态再淡出；约 100ms 时 before `scale=1.00549 / opacity=0.808` → 下一帧 `1 / 1`。
- 与 UI spec「从当前视觉状态走 140ms 关闭」不一致；仅影响打开动画 <约 100ms 时关闭，非阻塞。按 Lead 要求只记录、不修。
- 证据：`round4-qa-anim-interrupt.png`（40ms 中点帧）。

**动画后 smoke**：1440 面板 880×820 @ (280,40)、按钮 56×56 @ (1180,40)；点面板不关闭、按钮 popup 保持；右键/Esc/遮罩关闭；悬浮 3 行 preview/summary/原图请求 0；P1 连续打开 5 次 img opacity=1、占位 0；方形封面占位 0、槽透明。E2E 17 条全绿。

### E. 门禁与收尾

#### E14 门禁 — 通过

- `TMPDIR=$PWD/.tmp pnpm test`：15 files / **207 passed**（9.54s）。
- `pnpm typecheck`：0 error。
- `TMPDIR=$PWD/.tmp pnpm build`：通过；`/` 29.5 kB / First Load 159 kB。
- `TMPDIR=$PWD/.tmp PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers pnpm test:e2e`：**17 passed**（31.1s，含 4 档几何、关闭方式、滚动锁定、resize、767/触屏、弹性 pop、reduced-motion、P1/P2 回归）。

#### E15 收尾 — 通过

- 8004 已释放（`ss -ltnp | grep 8004` 无输出；无 next dev/next start/next-server 进程）。
- `.cache/covers.db` 已恢复为验收前快照：`user_version=5`、**172 行**、`large` 非空 **9**；本轮动效复验收尾仍为 172/9（未新增缓存行）。
- 临时脚本位于 `/tmp/bgm-qa5`，验收后删除；仓库只新增 QA 截图与本文档。
- 未提交 git；未修改业务代码/测试代码/设计文档。

## 3. 按钮 4 档 bbox（用户重点）

| 视口 | 面板 | 按钮 | 顶边 | 间距 | 右缘余量 |
| --- | --- | --- | --- | --- | --- |
| 1440×900 | (280,40,880,820) | **(1180,40,56,56)** | 40 = 40 | 20 | 204 |
| 1280×900 | (200,40,880,820) | **(1100,40,56,56)** | 40 = 40 | 20 | 124 |
| 1024×900 | (88,40,848,820) | **(952,40,56,56)** | 40 = 40 | 16 | 16 |
| 768×900 | (88,40,592,820) | **(696,40,56,56)** | 40 = 40 | 16 | 16 |

按钮为同一款 56×56 紧凑款；不是宽按钮；未压缩面板内部布局。

## 4. 观察记录（非缺陷）

1. **双击行**：左半区第一击打开弹窗、第二击落在遮罩 → 弹窗关闭；右半区第二击落在面板 → 弹窗保持。属未定义的双击行为，按 Lead 要求仅记录，不判缺陷。
2. **列表封面异步加载**：筛选/翻页后封面分块到达前，行卡片可能短暂显示「无封面」占位；等待分块完成后正常（前 10 行均为 `/r/200`）。这是 Round 3 既有行为，不是本轮新增回归。

## 5. 网络、资源与业务影响

- 页面加载：5 个 `subject.covers` 分块；前 10 行 `/r/200` 缩略图加载；原图 0；`api.bgm.tv` 浏览器请求 0。
- 悬浮 3 行：preview/summary/原图请求均为 **0**（只高亮）。
- 首次点击 Zelda：1 个 `subject.preview,subject.summary` 合并批次 + 1 张原图 **120,101 B**（`content-length`）；`subject.covers` 额外 0；浏览器 `api.bgm.tv` 0。
- 关闭后再次打开同一条目：preview/summary/原图请求均为 **0**（查询缓存 5min + 浏览器图片缓存）。
- 多次打开同一行 5 次：后续原图请求 0；面板几何不变。
- **性能/体验**：弹窗打开/关闭只改变 opacity/transform，面板几何固定，加载/失败/切换均无 CLS；打开 220ms 弹性 pop、关闭 140ms、reduced-motion 无动画；打开时背景 inert + 滚动锁定，关闭后恢复滚动与焦点；悬浮不再产生任何预览请求，显著减少误触网络开销。点击后单次资源开销与 Round 3 首次悬浮相同（原图 120,101 B），暖缓存重复打开为 0 请求。P2-01 仅影响打开中途关闭的视觉连续性。

## 6. 缺陷表

| ID | 级别 | 状态 | 说明 |
| --- | --- | --- | --- |
| — | P0 | 无 | 无阻塞/崩溃/不可用问题 |
| — | P1 | 无 | 无封面不显示、居中/按钮错位、滚动锁定失效等核心问题 |
| P2-01 | P2 | 观察（非阻塞，不要求修） | 打开动画未完成时关闭（<约 100ms）：面板从当前 scale/opacity 直接跳到 keyframe 起点 scale=1/opacity=1 再淡出，产生一次闪跳。最小复现：打开后约 40ms 按 Esc，before 0.981/0.462 → 下一帧 1/1；约 100ms 时 0.808 → 1。归属 frontend；仅中途关闭路径，正常打开/关闭不受影响。 |

## 7. 未验证项 / 限制

1. **真实桌面经典滚动条**：headless 使用覆盖式滚动条，`innerWidth-clientWidth=0`，body padding-right 实测 0；未复现经典滚动条下 1024 面板约 833、按钮右缘余量约 8 的边界。UI spec 已接受该差异。
2. **跨浏览器**：仅在 Chromium 1248 验证；Firefox/WebKit 未测。
3. **实体触屏设备**：使用 Playwright `hasTouch`/`isMobile` 模拟 `(hover:none)`/`(pointer:coarse)`；未在实体手机/平板上验证。
4. **1920 宽 / 极矮视口**：本次覆盖 1440/1280/1024/768/767；1920 与 `vh<600` 的收缩/提示位置未逐一截图。
5. **Ctrl/Cmd/中键点击行**：未逐一验证是否保留新标签直跳（设计列为剩余待确认，不阻塞）。
6. **原生右键菜单**：headless 无法显示浏览器菜单，只能验证 `contextmenu` 事件被 `preventDefault`；已在面板/按钮/遮罩/文字/滚动条上验证 prevented=true。

## 8. 证据索引

- 几何/按钮：`round4-qa-1440x900.png`、`round4-qa-1280x900.png`、`round4-qa-1024x900.png`、`round4-qa-768x900.png`
- 悬浮无预览/标签：`round4-qa-hover-only.png`、`round4-qa-tag-chip.png`
- 状态：`round4-qa-loading.png`、`round4-qa-preview-fail.png`、`round4-qa-fallback.png`、`round4-qa-all-fail.png`、`round4-qa-no-cover.png`、`round4-qa-square.png`
- 滚动/长内容：`round4-qa-longsummary.png`
- 767/触屏：`round4-qa-767x900.png`、`round4-qa-touch.png`
- 回归/列表：`round4-qa-regression.png`、`round4-qa-list.png`
- 弹性 pop：`round4-qa-anim-open.png`（120ms 中点帧）、`round4-qa-anim-interrupt.png`（40ms 中断前帧）
