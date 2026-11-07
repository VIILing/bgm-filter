# Round 3 · 条目预览面板 V2 · QA 独立验收报告

> 验收对象：`docs/round3-requirements.md`、`docs/ui-design.md` §2.12、`docs/round3-ui-spec.md`、`docs/round3-plan.md`。
> 验收方式：真实 `prisma/dev.db`（700,108 条）+ 真实 Bangumi 封面 + 独立 Chromium（Playwright）。QA 未修改任何业务代码、测试代码或设计文档。
> 验收时间：2026-11-04。代码基线含 frontend 对 P1（封面重复悬浮）与 P2-02（占位衬底）的最终修复。

## 1. 结论

**通过。** 当前无阻塞项、无未修复 P0/P1。

| 项 | 数量 | 说明 |
| --- | --- | --- |
| P0 | 0 | — |
| P1 | 1（已修复并复测） | 暖缓存重复悬浮时封面 `opacity:0`；前端修复后 6 次重复悬浮、3 条切换回归均通过 |
| P2 | 1 未关闭 + 1 已修复 | 未关闭：部分原图体积远超 33–120 KB 预期（实测最大 560 KB）；已修复并复测：P2-02 非 2:3 封面的 2:3 灰色占位衬底 |

质量门禁全部通过：

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 单元 + 真实数据集成 | `TMPDIR=$PWD/.tmp pnpm test` | **15 files / 207 tests passed**，9.68 s |
| 类型 | `pnpm typecheck` | **0 error**（exit 0） |
| 构建 | `TMPDIR=$PWD/.tmp pnpm build` | **通过**；`/` 首屏 JS 27.8 kB / 157 kB |
| E2E（含 P1/P2-02 回归） | `TMPDIR=$PWD/.tmp PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers pnpm test:e2e` | **5 passed**，20.1 s |

环境：Node v27.0.0-alpha / pnpm 12.16.1；Chromium 1248（`PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers`）；dev 8004；`TMPDIR=$PWD/.tmp`；真实数据 `Subject=700,108`。

## 2. 验收清单逐条结果

### A. 功能与视觉

#### A1 有封面条目：封面与信息完整 — 通过

- 1440×900 悬浮第 1 条「ゼルダの伝説 ブレス オブ ザ ワイルド」：
  - 原图 `https://lain.bgm.tv/pic/cover/l/60/d8/62229_5Yt0j.jpg`（无 `/r/` 缩放段），自然尺寸 640×1039。
  - 显示尺寸 262.64×426.38，比例 0.6158（自然比例 0.6159），高度受限、完整显示、不裁边、不放大。
  - 封面槽 300×426.4，图片在槽内居中；槽宽/高不随图片比例变化。
- 右栏信息完整：原名、中文名「塞尔达传说 旷野之息」、类型「游戏」、日期 2017-03-03、9.4 分、7,154 人评分、排名 #1、标签 10 + 公共标签 5；无「看过」。简介区具备内部滚动容器，长简介可滚（见 C10）。
- 长标题「さくら、もゆ。-as the Night's, Reincarnation- ミュージックコレクション」：`h3` 306×50.38，`-webkit-line-clamp:2`，`scrollHeight=76 > clientHeight=50`，两行截断、无横向溢出。
- 不放大/极端比例（Playwright route 注入受控原图，仅验证 CSS 规则，不是真实条目）：
  - 150×225 原图 → 显示 150×225（不放大）；
  - 1200×300 原图 → 显示 300×75（超宽，槽内留白，右栏几何不变）。
- 非 2:3 方形封面（`/?q=さくら、もゆ` 第 1 条，原图 500×500，显示 300×300）：加载后 2:3 占位 `opacity=0`，封面槽背景透明、面板白底，无灰色衬底；加载中占位可见，`large` 失败回退 common 后占位隐藏，全部失败/无封面时占位可见并显示「无封面」。P2-02 修复复验通过。
- 证据：`docs/screenshots/round3-qa-1440x900.png`、`round3-qa-longtitle.png`、`round3-qa-square-cover.png`、`round3-qa-square-loading.png`、`round3-qa-square-fallback.png`、`round3-qa-square-fail.png`、`round3-qa-noupscale-150x225.png`、`round3-qa-noupscale-1200x300.png`。

#### A2 面板几何与规格一致、无横向溢出、加载/失败不跳动 — 通过

实测（Playwright `getBoundingClientRect`，DPR=1，headless 无经典滚动条）：

| 视口 | 面板 bbox | 内边距 | 上区高 | 封面槽 | 右栏 | 标签可视高 | 简介可视高 | `docScrollWidth` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1440×900 | 880×820 @ (472,64)，右缘 1352 | 24 | 426.4 | 300×426.4 | 506 | 303 | 281 | 1440 |
| 1280×900 | 880×820 @ (376,64)，右缘 1256 | 24 | 426.4 | 300×426.4 | 506 | 303 | 281 | 1280 |
| 1024×900 | 848×820 @ (152,64)，右缘 1000 | 20 | 426.4 | 288×426.4 | 498 | 306 | 289 | 1024 |
| 1024×768 | 848×688 @ (152,64)，右缘 1000 | 20 | 357.8 | 288×357.8 | 498 | 237 | 225 | 1024 |
| 768×900 | 592×820 @ (152,64)，右缘 744 | 16 | 426.4 | 208×426.4 | 334 | 253 | 297 | 768 |
| 767×900 | 不出现 | — | — | — | — | — | — | 767 |

- 所有视口 `documentElement.scrollWidth === innerWidth`，无横向溢出；面板右缘均 ≤ 视口宽 - 24。
- 1024 宽实测 848px（headless 覆盖式滚动条，`innerWidth===clientWidth`）。真实桌面经典滚动条下按 `100vw-176px` 预计约 833px，属 Lead 已确认取舍；本次未在带经典滚动条的桌面浏览器单独实测。
- 加载前/加载后/失败/无封面四种状态下面板、上区、封面槽 bbox 完全一致（见 B6/B7），无跳动。
- 证据：`round3-qa-1440x900.png`、`round3-qa-1280x900.png`、`round3-qa-1024x900.png`、`round3-qa-1024x768.png`、`round3-qa-768x900.png`、`round3-qa-767x900.png`。

#### A3 断点、触屏、resize/滚动关闭 — 通过

- 1024：`lg` 紧凑布局（内边距 20、封面列 288、间距 20，元信息右侧 184 宽三行），无挤压、无重叠。
- 768：紧凑双列（内边距 16、封面列 208、间距 16，元信息移到标题下方横排），右栏 334 不换行、不溢出。
- 767 宽：悬浮 800ms 后无面板（count=0）。
- 触屏 `(hover:none)`：Playwright `hasTouch:true` 上下文实测 `matchMedia('(hover:hover)')=false`、`(hover:none)=true`、`(pointer:coarse)=true`，悬浮无面板（count=0）。
- 打开面板后 `setViewportSize(1200×900)`：面板 count=0；恢复 1440 后重新悬浮，`window.scrollBy(0,400)`：面板 count=0、scrollY=400。均符合“resize/页面滚动关闭”。
- 1024 面板左缘 152，列表行左缘约 25，左侧可操作条带约 127px；实测用 x≈95 可正常切换行，符合已确认取舍。
- 证据：视口截图同上、`round3-qa-hover-none.png`。

#### A4 连续切换 3 个条目、无残影、滚动回顶、迟到 onLoad — 通过

修复后（最终代码）：

- 依次悬浮 0→1→2→0→1→0：每次最终 `img.complete=true`、`naturalWidth>0`、`opacity=1`；标题/封面/标签/简介均正确切换；面板 bbox 恒为 (472,64,880,820)。
- 第 4、5、6 次回到已看过的条目：新增原图请求 **0**（浏览器缓存命中），封面仍立即可见（不是靠延时掩盖）。
- 长简介条目（Yes, Minister S3）滚动到 `scrollTop=95` 后切到 Xenoblade2：`summaryScrollTop` 回到 0，标签区回到 0；旧图不残留。
- 切换采样：指针进入新行后 150ms 内完成条目切换；切换瞬间旧 `<img>` 即卸载，新图在 `opacity:0` 占位下等待 `onLoad`，随后 120ms 淡入；未观察到旧图点亮新条目。
- 迟到 onLoad：将 62229 原图延迟 3s，悬浮 62229 后立即切到 18462；3.6s 后面板仍为 18462 的图（`/92/46/18462_30u1i.jpg`），62229 的迟到图未点亮。
- 证据：`round3-qa-rehover-fixed.png`、`round3-qa-switch-late-onload.png`、`round3-qa-switch-long-a.png`、`round3-qa-switch-long-b.png`、`round3-qa-switch-long-c.png`、`round3-qa-switch-long-d.png`。

#### A5 点击面板不跳转、行左半区跳转、关闭后正常 — 通过

- 点击面板简介区：URL 不变，新页面数 0（`page.url()` 前后相同，`context.pages().length` 不变）。
- 移出面板等待关闭后：点击第 1 行左半区（x≈167）捕获 popup，URL 为 `https://bgm.tv/subject/62229`，随后关闭 popup；未真实浏览。
- 关闭后点击行为正常；E2E `preview.spec.ts` 的点击/滚轮用例同时通过。
- 证据：流程记录见本文；E2E 5 passed。

### B. 状态与降级

#### B6 原图加载中：文字先出、2:3 占位、淡入 — 通过

将 row0 原图请求延迟 2.5s 后：

- 250ms 时：标题/中文名/类型/日期/评分/标签/简介均已显示；`img.complete=false`、`naturalWidth=0`、`opacity=0`；占位块 284.27×426.39（2:3），槽 `aria-busy="true"`。
- 加载完成：`img` 262.64×426.38、`opacity=1`；面板/上区/槽 bbox 与加载中逐项完全相同（`panelSame=true`、`slotSame=true`、`upperSame=true`）。
- 证据：`round3-qa-loading.png`、`round3-qa-loaded.png`。

#### B7 图片失败：large→common→small→grid→无封面 — 通过

- 仅 abort 原图（无 `/r/`）：自动换源到 `https://lain.bgm.tv/r/400/pic/cover/l/60/d8/62229_5Yt0j.jpg`，自然尺寸 400×649，显示 262.8×426.38，`opacity=1`；面板几何不变。
- abort 全部 `lain.bgm.tv` 图片：4 个候选全部失败后不渲染 `<img>`，占位静态显示「无封面」，无破图图标；面板仍 880×820，几何不变。
- 证据：`round3-qa-fallback-common.png`、`round3-qa-no-cover-failed.png`。

#### B8 真实无封面条目 — 通过

- 真实条目 id `444549`「狂人游戏：中国精神病人」（`subject.covers` 返回 `null`，搜索 `q=游戏&page=3` 第 49 行）。
- 面板：无 `<img>`，2:3 占位显示「无封面」；标题/类型「游戏」/日期 2023-06-26/10.0 分/1 人评分（rank=null 不显示排名）/标签 0/公共标签 PC·游戏/简介均正常。
- 证据：`round3-qa-no-cover-real.png`。

#### B9 预览接口失败 — 通过

- 拦截 `subject.preview`/`subject.summary` 所在 tRPC 批次：标签区显示「预览加载失败」，简介区显示「暂无简介」；封面、标题、元信息仍正常；面板 880×820 不变；列表行本身不受影响。
- 证据：`round3-qa-api-fail.png`。

### C. 滚动与交互

#### C10 内部滚动不带动页面；面板外滚轮正常 — 通过（标签区真实数据未溢出，见限制）

- 长简介「Yes, Minister (Series 3)」：简介 `clientHeight=281`、`scrollHeight=376`；在简介内滚轮 2000 后 `scrollTop=95`（到底），`window.scrollY` 始终为 0。
- 标签区：真实数据中 `tagsJson` 最多 10 个标签，1440/1024/768 实测 `scrollHeight===clientHeight`，无真实溢出；为验证容器行为，QA 只在页面 DOM 临时注入 30 个标签（不改业务代码）：`clientHeight=303`、`scrollHeight=321`，滚轮后 `scrollTop=18` 到底，`window.scrollY=0`。
- 面板外滚轮：面板打开时鼠标移到左侧列表外，滚轮 700，`scrollY 0→700`，面板关闭；符合“面板外仍正常滚页面”。
- 证据：`round3-qa-longsummary.png`。

#### C11 快速划过不逐条请求、同一时刻只有一块面板 — 通过

- 暖缓存页面加载完成后，以 40ms 间隔快速划过 3 个可见行并停在最后一行：
  - 中间过程面板 count=0；
  - 最终面板 count=1；
  - 请求仅 **1** 个 `subject.preview,subject.summary` 批次，id=238923（最终悬停行），没有为前两行发预览请求。
- 同一时刻面板 DOM 始终 ≤1。

### D. 性能与资源

#### D12 暖缓存悬浮网络与浏览器缓存 — 通过（修复后）

- 页面封面 5 个 `subject.covers` 分块请求完成后开始计时；悬浮 row0（62229）：
  - `subject.covers` 请求 **0**；
  - `subject.preview` / `subject.summary` 各 1（本地 tRPC，合并为 1 个 HTTP 批次）；
  - 浏览器可见 `api.bgm.tv` 请求 **0**；
  - 原图请求 1 个，**120,101 bytes**；
  - 服务端缓存行 `fetchedAt=1793793686311` 前后不变（未回源），`large` 列为 NULL 但读取时从 common 推导原图。
- 关闭面板后再次悬浮同一条目：原图请求 **0**（浏览器缓存命中），封面 `opacity=1`；E2E 新增用例亦覆盖。
- 抽查 3 条原图体积：120,101 B（640×1039）、235,093 B（827×1200）、560,386 B（1800×2500）。**注意：560 KB 明显高于需求预估的 33–120 KB，见 P2-01。**
- 证据：`round3-qa-warm-hover.png`、`round3-qa-rehover-fixed.png`。

#### D13 冷浏览器上下文首次悬浮：文字先出、封面后到、列表不加载原图 — 通过

- 全新 context（空浏览器缓存），列表首屏：`subject.covers` 5 批；`/r/200` 小图 **25 张、340,363 bytes**；原图请求 **0**；`api.bgm.tv` 0。
- 将原图延迟 2.2s 后首次悬浮：250ms 时标题/元信息/简介已显示，封面未完成；面板/槽 bbox 与加载完成后完全相同；3.2s 后原图 640×1039、`opacity=1`，请求 120,101 B。
- 与列表首屏对比：列表仍只加载 `/r/200` 缩略图，未变成加载原图。
- 证据：`round3-qa-cold-early.png`、`round3-qa-cold-late.png`。

#### D14 封面缓存库统计与旧行回退 — 通过

只读统计（验收开始前快照 / 全部 QA 与 E2E 结束后快照；结束后已还原为开始前快照）：

| 指标 | 开始前 | 结束后（还原前） |
| --- | --- | --- |
| `PRAGMA user_version` | 5 | 5 |
| 总行数 | 163 | 845 |
| 正缓存 | 163 | 842 |
| 负缓存 | 0 | 3 |
| `large` 非空行 | **0** | 679 |
| `summaryFetched=1` | 163 | 845 |

- 旧行回退实测：id `9499`（缓存 `large=NULL`，common=`/r/400/...`）通过 `subject.covers` 返回推导原图 `https://lain.bgm.tv/pic/cover/l/6f/16/9499_jp.jpg`（无 `/r/`）；搜索 `q=ベルセルク (22)` 悬浮后面板显示该原图，自然 351×500、`opacity=1`。无需用户清缓存。
- 说明：上表为第一轮全量验收的快照；P2 修复复验轮开始前/结束后为 165 行、large 非空 2，结束后已恢复为该快照（见 E17）。
- 旧行 `large` 仍为 NULL，但读取层推导；新行写入真实 large。符合 disk/迁移设计。
- 证据：`round3-qa-old-cache-large.png`。

### E. 回归与质量门禁

#### E15 筛选/搜索/类型/年代/排序/分页/URL/行内封面 — 通过

| 场景 | 实测 |
| --- | --- |
| 非法标签表达式 `科幻 &&` | 红字「⛔ 运算符 "&" 缺少操作数（第 4 个字符附近）」；暂停查询、保留上次结果；无异常请求 |
| 合法标签 `科幻` | 共 **7,331** 条；URL `?tag=科幻`（debounce 后约 600ms 更新） |
| 名称搜索 `攻壳` | 共 **41** 条；URL `?q=攻壳` |
| 类型只选动画 | 共 **31,258** 条；URL `?types=2` |
| 年代 2000–2010 | 共 **122,392** 条；URL `?from=2000&to=2010` |
| 评分从高到低 | 首行为 10.0 分条目；URL `?sort=score_desc` |
| 评分从低到高 | 首行为 1.0 分条目；URL `?sort=score_asc` |
| 无评分置顶 | 首行为「— 无评分」；URL 含 `scoreless=first` |
| 恢复综合评分/置底 | 首行回到 9.4 分 Zelda；URL 回到 `/` |
| 分页 | 第 2 页 `?page=2`、第 3 页 `?page=3`；总数仍 700,108，结果变化 |
| 直接 URL 状态 | `tag=科幻&types=2&from=2000&to=2010&sort=score_desc&scoreless=first&page=2` 全部还原；共 476 条 |
| 非法 URL 参数 | `types=99&from=abc&to=9999&sort=foo&scoreless=bar&page=-2` 回退默认（全类型、加权、page 1），URL 归一为 `/`，共 700,108 |
| 列表布局 | 50 行；行封面 76×114（2:3）；`docScrollWidth=1440` 无横向溢出 |

证据：`round3-qa-filter-tag.png`、`round3-qa-search-name.png`、`round3-qa-url-state.png`、`round3-qa-list-1440x900.png`。

#### E16 质量门禁 — 通过

- `TMPDIR=$PWD/.tmp pnpm test`：15 files / **207 tests passed**，9.68s。
- `pnpm typecheck`：exit 0，0 error。
- `TMPDIR=$PWD/.tmp pnpm build`：通过；`/` 27.8 kB，First Load JS 157 kB。
- `TMPDIR=$PWD/.tmp PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers pnpm test:e2e`：**5 passed**（含 `preview-rehover` 的 P1 与 P2-02 回归），20.1s。

#### E17 收尾 — 通过

- 8004 已释放（`ss -ltnp | grep 8004` 无输出；`pgrep` 无 next dev/next-server）。
- `.cache/covers.db` 已还原为验收前快照：user_version=5、165 行、large 非空 2。
- QA 未提交 git、未修改业务代码/测试代码/设计文档；工作区中的业务改动与新增 e2e 均来自开发，不属于 QA 变更。
- 临时 Playwright 脚本放在 `/tmp`（验收后删除）；仓库只新增 QA 截图与本文档。

## 3. 缺陷表

| ID | 级别 | 状态 | 现象 / 最小复现 | 归属 | 证据 |
| --- | --- | --- | --- | --- | --- |
| P1-01 | P1 | **已修复并复测通过** | 暖缓存重复悬浮同一条目时封面不显示：① 1440×900 打开 `/`，等首屏加载；② 悬浮第 1 行，封面正常；③ 移出等面板关闭，再悬浮同一行；④ 文字/标签/简介正常，但封面槽只剩灰色 pulse 占位；`img.complete=true`、`naturalWidth=640`、`currentSrc` 正确、`opacity=0`，2.5s 不恢复；第三次悬浮又可能恢复 | frontend | 修复前：`round3-qa-rehover-second.png`；修复后：`round3-qa-rehover-fixed.png`；根因：挂载后 effect 清空 loadedUrl 与缓存 onLoad 竞态 |
| P2-01 | P2 | 待产品/设计确认 | 原图体积超出需求预估：需求 §6 预期每次 33–120 KB，实测 3 条为 120,101 B、235,093 B、560,386 B（1800×2500）；慢网首次悬浮单张可达 560 KB，且解码内存更大 | 产品/设计（非功能缺陷） | 本文 D12 数据；可复现悬浮 1440 下第 1/2/3 行 |
| P2-02 | P2 | **已修复并复测通过** | 非 2:3 原图（如正方形专辑封面）加载完成后，2:3 `slate-100` 占位块仍留在图片下层，形成上下灰色衬底。修复：loaded 后占位 120ms 淡出；加载中/回退中/无封面仍显示。复验：方形 500×500 封面加载后 `placeholder opacity=0`、槽背景透明、面板白底；large 失败回退 common 后占位隐藏；全部失败/无封面占位可见。 | frontend | 修复前：`round3-qa-longtitle.png`；修复后：`round3-qa-square-cover.png`、`round3-qa-square-loading.png`、`round3-qa-square-fallback.png`、`round3-qa-square-fail.png` |

## 4. 未验证项 / 限制

1. **1024 真实经典滚动条**：本次 headless Chromium 为覆盖式滚动条，实测面板 848px；未在带经典滚动条的桌面浏览器实测约 833px 的值。Lead 已确认该差异可接受，且所有视口未溢出/未挤压。
2. **真实触屏设备**：用 Playwright `hasTouch:true` 模拟 `(hover:none)/(pointer:coarse)`，未在实体手机上验证。
3. **服务端 `api.bgm.tv` 逐请求抓包**：本环境 `ptrace` 被禁，无法 attach 进程做 strace；采用「浏览器侧 `api.bgm.tv`=0 + 缓存行 `fetchedAt` 未变 + 本地 summary 响应 24–45ms」证明暖缓存未回源，非直接抓包。
4. **1920 宽 / 极矮视口**：需求 §4.5 与规格 §3.1 的 1920/`vh<600` 边界未逐一截图；1440/1280/1024/1024×768/768/767 已覆盖。
5. **标签区真实溢出滚动**：真实 dump 的 `tagsJson` 最多 10 个标签，1440/1024/768 下 `scrollHeight` 均等于 `clientHeight`，无法自然触发标签区滚动；C10 的标签滚动用 DOM 注入 30 个 chip 验证容器行为，未用真实数据复现。

## 5. 对用户的业务级影响

- **网络**：每首次预览一条新条目多下载 1 张原图；实测 120 KB–560 KB，重于需求预估的 33–120 KB。暖缓存/同条目再次悬浮不再下载原图；列表首屏仍使用 `/r/200` 缩略图（25 张 / 340 KB），不加载原图。
- **性能**：面板固定几何，加载/失败/切换均无 CLS；原图解码只影响当前一张；快速划过不逐条发请求（实测 3 行快速划过只发 1 个预览批次）。大图（1800×2500）解码成本与慢网等待是主要风险。
- **体验**：原图完整展示、无裁边、不放大；右栏信息与简介可读；面板打开时覆盖列表右半、需在左侧约 127px 条带切换行，属已确认取舍。P1 修复后暖缓存重复悬浮封面稳定可见；P2-02 修复后非 2:3 封面为白色留白。当前仅 P2-01（原图体积）待产品/设计确认。

## 6. 证据索引

- 视口几何：`round3-qa-1440x900.png`、`round3-qa-1280x900.png`、`round3-qa-1024x900.png`、`round3-qa-1024x768.png`、`round3-qa-768x900.png`、`round3-qa-767x900.png`
- 加载/失败/无封面：`round3-qa-loading.png`、`round3-qa-loaded.png`、`round3-qa-fallback-common.png`、`round3-qa-no-cover-failed.png`、`round3-qa-no-cover-real.png`、`round3-qa-api-fail.png`
- 冷/暖缓存：`round3-qa-cold-early.png`、`round3-qa-cold-late.png`、`round3-qa-warm-hover.png`
- P1 回归：`round3-qa-rehover-second.png`（修复前）、`round3-qa-rehover-fixed.png`（修复后）、`round3-qa-switch-late-onload.png`
- 切换/长内容：`round3-qa-switch-long-a.png`、`round3-qa-switch-long-b.png`、`round3-qa-switch-long-c.png`、`round3-qa-switch-long-d.png`、`round3-qa-longsummary.png`、`round3-qa-longtitle.png`
- 封面规则：`round3-qa-noupscale-150x225.png`、`round3-qa-noupscale-1200x300.png`、`round3-qa-old-cache-large.png`
- P2-02 复验：`round3-qa-square-cover.png`、`round3-qa-square-loading.png`、`round3-qa-square-fallback.png`、`round3-qa-square-fail.png`、`round3-qa-switch-3items-final.png`
- 回归/布局：`round3-qa-filter-tag.png`、`round3-qa-search-name.png`、`round3-qa-url-state.png`、`round3-qa-list-1440x900.png`、`round3-qa-hover-none.png`
