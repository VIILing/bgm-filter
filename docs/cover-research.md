# 封面数据可行性调研（cover-research）

> 目的：判断能否为结果卡片补上封面图，走哪条路、成本多大、合规风险如何。
> 性质：**只调研，不改业务代码**。本文所有数字除标注【推算】外均为真实请求实测。
> 调研时间：2026-11-03 18:13–18:18（Asia/Shanghai）
> 环境：Linux x64 / curl 8.5.0 / Node v27.0.0；出口经香港（响应头 `cf-ray: ...-HKG`）
> 被测数据：本地 `prisma/dev.db`，Subject 700,108 条，id 范围 1–716,693，dump 无封面字段（已核实：`subject.jsonlines` 首行 16 个 key，无 `images`）

---

## 0. 结论先行

**能拿到封面，而且质量很好；但不能全量预抓，只能按需取。**

| 问题 | 结论 |
| --- | --- |
| 官方 API 能拿到封面吗 | ✅ 能。`GET https://api.bgm.tv/v0/subjects/{id}` 返回 5 种尺寸的 `images` 对象 |
| 是否需要 User-Agent | ✅ **必须**。无 UA 且未命中 CDN 缓存时返回 `403 {"description":"Please set a 'User-Agent'"}` |
| 图片能直接下载吗 | ✅ 能。`lain.bgm.tv` 返回 `200 image/jpeg`，**不校验 Referer、无防盗链**，`/r/*` 变体还带 `Access-Control-Allow-Origin: *` |
| 有官方限流吗 | ⚠️ 有。源码默认 **3000 次 / 10 分钟 / IP**，超限直接 **封禁 1 小时**（不是简单 429 退避）；响应**不带**任何 `x-ratelimit-*` 头，无法提前感知 |
| 700k 全量预抓可行吗 | ❌ **不可行**。1 req/s 需 **8.1 天**，JSON 约 **2.1 GB**，图片 9.8–26.4 GB；且违反官方「仅获取必要数据、不得以爬虫方式摘录」条款 |
| 能否按 id 批量查 | ❌ 不能。搜索接口按关键词、列表接口按 type 浏览，**都没有 id 批量入参**；搜索单页被钳到 20 条、总量上限 1000 条 |
| 推荐方案 | ✅ **B + C 混合**：tRPC 服务端按需解析 URL（B），浏览器直连 `lain.bgm.tv` 加载图片（C）。缓存只存 URL 字符串，失败降级为无图 |
| 首屏成本（50 条） | 缓存命中：0 次外部请求；冷启动：50 次 API ≈ **2–3 s**（并发 5，【推算】），图片约 **230 KB**（`/r/100`）～ **700 KB**（`/r/200`） |
| 最大风险 | ① 触发 1 小时封禁；② 封面版权（CC BY-SA + Fair use），**本地自用可以，再分发/打包不行**；③ 无网环境必须能优雅降级 |

一句话：**官方 API 完全够用，正确姿势是「按需解析 + 本地缓存 URL + CDN 直连图片」，不要碰全量预抓。**

---

## 1. 调研范围与方法

- 各端点请求均控制在 10 次以内；唯一例外是 `/v0/subjects/{id}` 路由，累计 **15 次**（UA 对照 4 + 样例 3 + 404 样例 1 + 连续请求测试 8），全部为**不同 id、串行、间隔 ≥50 ms**，未做并发轰炸。API 侧合计 **24 次**（单条 15 + 列表 6 + 搜索 3）；图片 CDN 约 50 次；文档/静态数据约 16 次。总计约 **90 次**外部请求，未爬取任何列表全量。
- 为看到**源站**真实行为，部分请求带随机 `cb=` 参数绕过 Cloudflare 边缘缓存（响应头 `cf-cache-status: BYPASS`）——这一步很关键，见 §2.1。
- 未抓取全量、未注册账号、未申请 token（全部匿名请求）。
- 临时脚本与原始响应落在 `/tmp/cover-research/`（见附录 B）。

---

## 2. 实测结论与证据

### 2.1 官方 API 基线 与 User-Agent 要求

**这是本次调研最重要的一个坑：不带 UA 有时也会返回 200。**

首次请求 `https://api.bgm.tv/v0/subjects/1`（不带 UA）返回 **200**，响应头 `cf-cache-status: HIT`、`age: 106`——命中了 Cloudflare 边缘缓存，**请求根本没到源站**，UA 校验被绕过。加随机参数强制回源后才暴露真实行为：

```
GET /v0/subjects/1?cb=<random>    （无 User-Agent）
HTTP/2 403   cf-cache-status: BYPASS
{"title":"Forbidden","details":{"path":"/v0/subjects/1","method":"GET"},"description":"Please set a 'User-Agent'"}
```

换成描述性 UA 后同一路径 `200`、`cf-cache-status: MISS`。

> **工程含义**：如果客户端不设 UA，本地开发时可能"看起来正常"（边缘缓存命中），上线/换 id 后随机 403，属于最难排查的那类 bug。**必须无条件设置 UA。**

官方 [user agent 文档](https://github.com/bangumi/api/blob/master/docs-raw/user%20agent.md) 要求：

- 非浏览器使用者必须指定带**开发者个人 ID + 应用名称**的 UA；分发的应用要带版本号；开源项目附主页。
- **"各种请求库的默认 UA 可能会被禁用"**；明确禁止 `database`、`Bangumi/1.0`、`Bangumi/1.3.13.0` 这类 UA。
- 本次实测使用的 UA：`bgm-filter-research/0.1 (https://github.com/example/bgm-filter; contact: dev@example.com)` → 稳定 200。

**实测证据表（API）**

| # | 请求 | 状态码 | 关键响应片段 | 耗时 | 体积 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| P1 | `GET /v0/subjects/1` 无 UA | 200 | `"images":{...}` | 0.035 s | 2,992 B | `cf-cache-status: HIT`，**缓存掩盖了 UA 校验** |
| P2 | `GET /v0/subjects/1?cb=…` 无 UA | **403** | `"description":"Please set a 'User-Agent'"` | 0.250 s | 182 B | `BYPASS`，源站真实行为 |
| P3 | `GET /v0/subjects/1?cb=…` 带 UA | 200 | 5 个尺寸 URL | 0.241 s | 2,992 B | `MISS` |
| P4 | `GET /v0/subjects/62229` 带 UA | 200 | `ゼルダの伝説…` | 0.310 s | 4,395 B | 游戏条目 |
| P5 | `GET /v0/subjects/1630` 带 UA | 200 | `あまつき (1)` | 0.305 s | 1,764 B | 书籍条目 |
| P6 | `GET /v0/subjects/99999999` 带 UA | 404 | `"description":"resource can't be found in the database or has been removed"` | 0.252 s | 223 B | 404 也是 JSON，可解析 |
| P7 | 连续 8 次 `GET /v0/subjects/{101..108}` | 8×200 | — | 0.240–0.292 s | ~1.7–2.0 KB/条 | **无一次 429**，响应头**无** `x-ratelimit-*` |

其他响应头（`/v0/subjects/62229`，MISS）：`cache-control: public, max-age=3600`、`content-type: application/json`、`vary: Origin, accept-encoding`。即**边缘缓存 1 小时**——同一批卡片一小时内重复查看，API 侧几乎零成本（实测命中时 0.035 s）。

> tRPC 服务端调用建议：`fetch(url, { headers: { 'User-Agent': 'bgm-filter/0.1 (local personal tool; contact: <你的 id>)', 'Accept': 'application/json' } })`，超时 5 s。
> 注意：Node 的 `fetch` **默认会发** `User-Agent: node`，属于"请求库默认 UA"，按文档有被禁风险，务必显式覆盖。

### 2.2 `images` 字段结构

`GET /v0/subjects/{id}` 顶层 19 个 key，其中 `images` 为固定 5 键对象：

```json
"images": {
  "small":  "https://lain.bgm.tv/r/200/pic/cover/l/c4/ca/1_d2tF2.jpg",
  "grid":   "https://lain.bgm.tv/r/100/pic/cover/l/c4/ca/1_d2tF2.jpg",
  "large":  "https://lain.bgm.tv/pic/cover/l/c4/ca/1_d2tF2.jpg",
  "medium": "https://lain.bgm.tv/r/800/pic/cover/l/c4/ca/1_d2tF2.jpg",
  "common": "https://lain.bgm.tv/r/400/pic/cover/l/c4/ca/1_d2tF2.jpg"
}
```

| 键 | 实际宽度 | 说明 |
| --- | --- | --- |
| `grid` | 100 px | 最小，列表网格用 |
| `small` | 200 px | **注意：`small` 比 `grid` 大**，命名反直觉 |
| `common` | 400 px | 卡片常用 |
| `medium` | 800 px | 详情页 |
| `large` | 原图（无 `/r/` 前缀） | 最大，且**不带 CORS 头**（见 §2.3） |

**无封面条目的真实形态**（重要）：`images` 不是 `null`，而是**空字符串**。实测 `GET /v0/subjects?type=1&limit=20&sort=date`（最新 20 本书）中有 **16/20** 是：

```json
"images":{"small":"","grid":"","large":"","medium":"","common":""}
```

→ 前端判断必须用 `!url`（空串与 null 都要覆盖），不能只判 `images == null`。

OpenAPI 里 `Images` 的 5 个字段都是 required（`open-api/v0.yaml` L2747–2771），但**实际值可能为空串**；schema 与实现不一致，以实测为准。

### 2.3 图片 CDN（`lain.bgm.tv`）

直链可 GET，且非常"友好"：

| # | 请求 | 状态码 | 关键响应头 | 体积 | 耗时 |
| --- | --- | --- | --- | --- | --- |
| I1 | `GET /pic/cover/l/c4/ca/1_d2tF2.jpg`（large，**无 Referer**） | 200 | `image/jpeg`、`cache-control: public, max-age=2592000`、**无 ACAO** | 32,959 B | 0.059 s |
| I2 | `GET /r/400/…` 带 `Referer: https://bgm.tv/subject/1` | 200 | `Access-Control-Allow-Origin: *`、`max-age=691200, immutable` | 28,401 B | 0.055 s |
| I3 | `GET /r/400/…` **无 Referer** | 200 | `Access-Control-Allow-Origin: *` | 50,894 B | 0.067 s |
| I4 | `GET /r/400/…` **`Referer: https://evil.example/page`** | **200** | 同上，字节数完全一致 | 50,894 B | — |
| I5 | `OPTIONS /r/400/…`（预检） | **405** | 无 CORS 头 | 166 B | — |
| I6 | `GET /pic/cover/l/c4/ca/1.jpg`（去掉 hash） | 404 | — | 162 B | — |
| I7 | `GET …/1_WRONG.jpg`（hash 写错） | 404 | — | 162 B | — |
| I8 | `GET /r/300/…`（非标准宽度） | **400** | `text/plain` | 68 B | — |
| I9 | `GET /r/100/…` | 200 | `image/jpeg` | 5,424 B（100×162） | 0.272 s |
| I10 | `GET /r/800/…` | 200 | `image/jpeg` | 103,949 B | 0.052 s |
| I11 | 10 个 `/r/100` **并发** | 10×200 | — | — | **wall 91 ms** |
| I12 | `/r/200/…` 模拟真实浏览器：`Referer: http://127.0.0.1:3080/` + Chrome UA + `Sec-Fetch-Dest: image` + 浏览器 `Accept` | 200 | `image/jpeg`、`access-control-allow-origin: *`、`max-age=691200, immutable` | — | `HIT`，**页面热链可行** |

结论：

1. **无防盗链**：带第三方 Referer 与不带 Referer 结果完全一致（I3 = I4，50,894 B）。
2. **无 UA 要求**：CDN 请求把 UA 置空仍 200。
3. **`/r/*` 变体带 `Access-Control-Allow-Origin: *`**，`large`（原图路径）**不带**。`<img>` 标签不受 CORS 约束，两种都能显示；但若前端用 `fetch`/`canvas`/`crossOrigin` 读像素，**只有 `/r/` 变体可用**，且 `OPTIONS` 返回 405（带自定义头会预检失败）。→ **一律用 `/r/` 变体。**
4. **URL 不可完整推导**：目录 `c4/ca` **是可以算出来的**——它就是 `md5(String(id))` 的前 4 位按 2+2 拆分（实测 8/8 命中，见 §2.7b）；但文件名后缀 `_d2tF2` 是**与 id 无关的随机 hash**，去掉或写错都 404（I6/I7）。→ **必须先从 API/HTML 拿到完整 URL，无法凭 id 拼出直链。**
5. **尺寸档位固定**：`/r/{100|200|400|800}/` 有效，`/r/300/` 直接 400（I8）。不要传任意宽度。

**体积均值（5 个真实封面采样）**

| 变体 | 平均体积 | 尺寸样例 |
| --- | --- | --- |
| `/r/100`（grid） | **4.7 KB** | 100×162 |
| `/r/200`（small） | **14.0 KB** | — |
| `/r/400`（common） | **37.8 KB** | 400×649 |
| `large`（原图） | 33–120 KB（波动大） | — |

封面长宽比普遍 1:1.6 左右（书籍/动画竖版）。

### 2.4 限流（这是最需要小心的地方）

**响应头里没有任何限流信息**：完整 dump 过 `hdr_62229.txt`，不存在 `x-ratelimit-*`、`ratelimit-*`、`retry-after`。→ 无法通过响应头做自适应限速。

**实测**：连续 8 次快速请求（间隔 50 ms）全部 200，未触发 429（P7）。以默认额度算，这只用了 0.3%。

**官方文档未写明速率限制**：`open-api/v0.yaml`（113 KB）中检索 `ratelimit|rate limit|429|throttl` **零命中**；`bangumi/api` 仓库 `docs-raw/` 只有 `How-to-Auth.md`、`Search-API.md`、`user agent.md` 三份文档，均未提限流。

**服务端源码才是权威**（[bangumi/server](https://github.com/bangumi/server)）：

```go
// config/config.go L50-54
RateLimit struct {
    LimitLongTime time.Duration `env:"RATE_LIMIT_LONG_TIME"  env-default:"1h"`
    LimitWindow   time.Duration `env:"RATE_LIMIT_WINDOW"     env-default:"10m"`
    LimitCount    uint          `env:"RATE_LIMIT_COUNT"      env-default:"3000"`
}
```

```lua
-- web/mw/ban.lua：超限不是"退避"，而是直接写入 1 小时长封禁键
if current <= tonumber(COUNT) then return 0 end
redis.call("set", LONG_BAN_KEY, 1, 'ex', tonumber(LONG_TIME))  -- 1h
return 1
```

```go
// web/mw/rate-limit.go：被封后每次请求都直接 429
return c.JSON(http.StatusTooManyRequests, res.Error{
    Title: "Too Many Request",
    Description: `too many request, you have be rate limited`,
})
```

要点：

- 默认 **3000 次 / 10 分钟 / 每 IP**（≈ 5 req/s 均值），按 **IP**（未登录）或 **用户 ID**（登录）计数。
- 超限即 **封禁 1 小时**，期间所有请求 429；**没有 Retry-After**，客户端只能自己指数退避。
- 该值可被环境变量覆盖，**生产实际阈值未知**；Cloudflare 层是否另有防护也未知。
- 结论：**自建并发上限 4–6、全局 ≤2 req/s** 是安全区（占额度 <1%），千万别按 5 req/s 贴着跑。

### 2.5 批量可行性（关键否决项）

| # | 请求 | 状态码 | 结果 | 耗时 | 体积 |
| --- | --- | --- | --- | --- | --- |
| S1 | `POST /v0/search/subjects?limit=3`，`{"keyword":"zelda"}` | 200 | `total:66`，`data[0].images` **有 5 个尺寸** | 0.273 s | 5,550 B |
| S2 | 同上 `limit=100` | 200 | **`limit` 被钳到 20**，`data` 仅 20 条；`total:1000` | 0.256 s | 40,121 B |
| S3 | 同上 `limit=10&offset=1000` | 200 | **`data:[]`**，`total:1000` | 0.238 s | 50 B |
| L1 | `GET /v0/subjects?type=2&limit=5&sort=rank` | 200 | 有 images；`total:9114` | **3.188 s** | 39,527 B |
| L2 | `GET /v0/subjects?type=1&limit=20&sort=date` | 200 | 有 images；16/20 为空串 | 2.553 s | 31,337 B |
| L3 | `GET /v0/subjects?type=2&limit=20&sort=rank` | 200 | 0/20 空；`total:9114` | 2.542 s | 154,640 B |
| L4 | `GET /v0/subjects?type=3&limit=20&sort=rank` | 200 | 0/20 空；`total:7994` | 2.784 s | 86,394 B |
| L5 | `GET /v0/subjects?type=4&limit=20&sort=rank` | 200 | 0/20 空；`total:6555` | 2.341 s | 98,786 B |
| L6 | `GET /v0/subjects?type=1&limit=20&sort=rank` | 200 | 0/20 空；`total:9600` | 2.630 s | 77,786 B |

结论：

1. **搜索接口确实返回 images**（S1），但：
   - 单页上限 **20 条**（请求 100 实际返回 20），`total` 被 **Meilisearch 上限 1000** 截断，`offset=1000` 直接空结果（S2/S3）。→ 任何一个关键词最多只能翻到 1000 条。
   - `filter` 只支持 `type / meta_tags / tag / air_date / rating / rating_count / rank / nsfw`，**没有 `id` 或 `id[]` 过滤**（`v0.yaml` L74–135）。→ **无法按 id 批量查封面**。
2. **列表接口 `GET /v0/subjects` 也返回 images**（L1–L6），但：
   - 必须指定 `type`，只能按 `date|rank` 浏览，同样**没有 id 入参**；
   - **极慢**：2.3–3.2 s/次（对比单条 0.25–0.31 s），且响应巨大（20 条约 80–155 KB，因为带 `summary`、`infobox`、`rating` 全量字段）；
   - `total` 与本地数据对不上（如 type=3：API `7994` vs 本地 `101,230`）→ **口径不明，不能用于全量枚举**。
3. 单个条目的 id 查询是**唯一可按需取封面的官方途径**。

### 2.6 全量预抓可行性计算【推算】

已知：Subject **700,108** 条（id 1–716,693，本地实测）。

| 指标 | 计算 | 结果 |
| --- | --- | --- |
| 1 req/s 全量耗时 | 700,108 s ÷ 86,400 | **8.10 天**（7×24 不间断） |
| 2 req/s | ÷ 2 | 4.05 天 |
| 5 req/s（贴着默认额度） | ÷ 5 | **1.62 天**，但极易触发 1 h 封禁 |
| JSON 元数据体积 | 700,108 × ≈3.0 KB（实测 1.76–4.40 KB） | **≈2.1 GB** |
| 图片体积（`/r/100`） | × 4.7 KB | 3.3 GB |
| 图片体积（`/r/200`） | × 14.0 KB | 9.8 GB |
| 图片体积（`/r/400`） | × 37.8 KB | **26.4 GB** |

> 以上按 100% 覆盖率算上界；实际有空封面（见 §2.2），真实体积约为其 70–85%。

**结论：全量预抓不可行**——8 天起步、多 GB 磁盘、700k 次请求恰好踩在「爬虫式批量摘录」的红线上，且中途任何一次触发限流就前功尽弃。**必须按需加载。**

### 2.7 替代来源

#### (a) 页面 `og:image` —— ❌ 没有

| # | 请求 | 状态码 | 结果 |
| --- | --- | --- | --- |
| H1 | `GET https://bgm.tv/subject/1`（浏览器 UA） | 200 | 36,121 B，**`og:` 出现 0 次**，无任何 `og:image` / `twitter:image` |
| H2 | `GET https://bgm.tv/subject/62229` | 200 | 73,285 B，同样 **0 个 og 标签** |

封面在 HTML 里是普通 `<img>`：

```html
<img src="//lain.bgm.tv/r/400/pic/cover/l/c4/ca/1_d2tF2.jpg" class="cover" />
```

- 没有反爬挑战（无 Cloudflare 5 秒盾、无验证码），但会 `set-cookie`（`chii_sid` 等）。
- **单页 36–73 KB，是 API 的 12–25 倍**；且依赖 `class="cover"` 这类样式类名，改版即碎。
- `https://bgm.tv/robots.txt`：`Disallow: /pic/`、`Disallow: /img/`、`Disallow: /js/`（`/subject/` 未禁）。
- → **抓 HTML 解析封面，比调 API 更贵、更脆、更不礼貌，不推荐**。

#### (b) `lain.bgm.tv` 直链规律 —— ⚠️ 部分可用

- **目录分片可精确推导**：`md5(String(id))` 的前 4 个 hex 字符，按 2+2 拆成两级目录。8/8 实测命中：

  | id | md5 前 4 位 | 实际路径 |
  | --- | --- | --- |
  | 1 | `c4ca` | `/c4/ca/` |
  | 62229 | `60d8` | `/60/d8/` |
  | 1630 | `4603` | `/46/03/` |
  | 241263 | `5d1e` | `/5d/1e/` |
  | 326 | `a666` | `/a6/66/` |
  | 876 | `67d1` | `/67/d1/` |
  | 25961 | `fd60` | `/fd/60/` |
  | 707671 | `7ff5` | `/7f/f5/` |

- **但文件名后缀（`_d2tF2`）推不出来**：它与 id 无固定关系（同一 id 换尺寸时后缀不变，说明是建库时写入的随机串），去掉或写错均 404（I6/I7）。
- → **直链不能凭空构造**（缺最后一段），只能作为「拿到 URL 之后的图片投递通道」。这正是方案 C 的定位。
- 附带价值：目录可算 ⇒ 若将来做本地图片缓存，可自己按 md5 分桶存盘，与远端结构对齐，便于排障。

#### (c) `bangumi-data` 静态数据集 —— ❌ 不含封面

实测 `https://raw.githubusercontent.com/bangumi-data/bangumi-data/master/data/items/1943/04.json`（200，840 B），条目字段仅：

```
begin, broadcast, comment, end, lang, officialSite, sites, title, titleTranslate, type
```

- `sites` 里只有 `{"site":"bangumi","id":"88595"}` 这类 **id 映射**，**无 images**。
- 且它只覆盖日本动画的一个子集（远小于 70 万），仓库无 license 声明（`license: null`）。
- → **只能用来做 id 对齐，不能当封面源。**

#### (d) 第三方镜像 / 代理 —— ⚠️ 不推荐

- 未做实测（避免把请求打到不明来源、也避免合规风险）。
- 风险：可用性无保证、可能二次压缩/加水印、可能记录访问、版权状态更模糊。
- → **不建议引入**；官方 CDN 本身已经无防盗链、无 UA 要求，没有找镜像的必要。

---

## 3. 三种方案对比

| 维度 | **A. 全量预抓** | **B. 按需懒加载 + 本地缓存**（推荐） | **C. 纯 CDN 直链**（作为投递层） |
| --- | --- | --- | --- |
| 做法 | 离线跑脚本遍历 700k id，存 URL/图片 | 卡片渲染时批量按 id 查，URL 入库缓存 | 浏览器直接 `<img src="https://lain.bgm.tv/r/200/…">` |
| 外部请求量 | **700,108 次** | 仅未命中缓存的 id；二次访问 0 次 | 与 B 相同（只加载已解析的 URL） |
| 耗时 | **8.1 天** @1 req/s（1.6 天 @5 req/s，但会被封） | 首屏 50 条：**2–3 s**（并发 5）【推算】；缓存命中 **0 ms** | 图片本身 50 张 ≈ **0.1–0.3 s**（10 并发实测 91 ms） |
| 存储 | 2.1 GB JSON + 3.3–26.4 GB 图片 | 仅 URL：**≈250 B/条**，700k 全填满 ≈175 MB；只填访问过的更少 | 0（浏览器缓存，`immutable` 8 天） |
| 磁盘/带宽压力 | 极大 | 极小 | 无（图片走用户带宽 + 浏览器缓存） |
| 触发限流风险 | **高**（700k 次必然触发） | 低（自然访问量 < 额度 1%） | 无（CDN 不限流） |
| 合规 | ❌ 违反「仅获取必要数据 / 不得爬虫式摘录」 | ✅ 符合 | ✅ 图片投递，需注意版权 |
| 离线可用 | ✅ | ❌（可加图片落盘缓解） | ❌ |
| 实现复杂度 | 低（但跑得久） | 中（缓存 + 并发控制 + 降级） | 低 |
| 结论 | **否决** | **采用** | **采用（B 的投递层）** |

**B + C 的分工**：API 只负责「id → URL」的一次性解析（B），URL 缓存后永不再查；图片字节永远由浏览器直连 CDN（C），服务端不代理二进制、不占带宽。

**首屏成本细化（50 条/页，本项目 `pageSize` 固定 50）**

| 场景 | API 请求 | 首屏额外耗时 | 图片流量 |
| --- | --- | --- | --- |
| 全部命中缓存 | 0 | 0（随 tRPC 主查询返回） | 50 × 4.7 KB ≈ **235 KB**（`/r/100`） |
| 冷启动，并发 5 | 50 | **≈2.5–3.0 s**【推算：50/5 × 0.27 s】 | 50 × 14 KB ≈ **700 KB**（`/r/200`，2× DPR） |
| 冷启动，并发 8 | 50 | ≈1.7 s【推算】 | 同上 |
| 只取视口内 12 条 | 12 | ≈0.6–0.8 s【推算】 | ≈170 KB |

> 建议**不要阻塞首屏**：先渲染无图卡片（骨架/占位色块），封面到位后再替换，用户感知延迟接近 0。

---

## 4. 合规与风险

### 4.1 API 使用条款（硬性）

来自 [Bangumi 版权声明 / 开发者平台使用协议](https://bgm.tv/about/copyright)（页面标注最后更新 2022-10-04）原文要点：

- 「开发者应当在 **API 提供的接口范围内**获取数据，**不以侵犯或可能侵犯 Bangumi 以及平台用户权益的方式使用网络爬虫或类似的方式进行数据收集以及数据摘录**。」
- 「开发者应当**仅获取为应用或服务运行及功能实现目的而必要的数据**。」
- 「开发者**不得私自以任何形式将平台数据提供给任何其他第三人使用**。」
- 「Bangumi 有权**限制或阻止**开发者获取用户数据及平台数据。」
- 终止服务后「必须立即删除全部从 Bangumi 开发者平台中获得的数据」。

→ 全量预抓（方案 A）与上述三条直接冲突；按需 + 缓存（方案 B）属于「必要数据」，风险可控。

### 4.2 UA 与限流（必须遵守）

| 项 | 要求 | 违反后果 |
| --- | --- | --- |
| User-Agent | 含**开发者 ID + 应用名**（开源项目附主页）；禁用请求库默认 UA、禁用 `Bangumi/1.0` 式泛化 UA | 403 `Please set a 'User-Agent'`；可能被 Cloudflare 拦截 |
| 速率 | 自建 ≤2 req/s、并发 ≤6；**默认额度 3000/10min/IP** | 429 + **1 小时封禁**，无 Retry-After |
| 重试 | 429/5xx 指数退避（≥2 s 起），最多 2 次；连续失败熔断 60 s | 硬刚会延长封禁 |

### 4.3 图片版权（最需要用户拍板的部分）

- Bangumi 版权声明：「条目信息（**包括但不限于封面**、内容介绍、章节信息）均由用户提供，遵循 **Creative Commons BY-SA License** 协议，其版权归**创作者**所有。对于已有版权的作品遵照 **Fair use** 原则处理，并标注来源。」
- 即：**封面版权不属于 Bangumi，也不属于你**，CC BY-SA 只覆盖"条目信息"的编排，作品封面本身仍归原权利人。

| 使用场景 | 判断 |
| --- | --- |
| 本地个人工具、自己看（不对外提供服务、不打包分发） | ✅ 风险很低，属 Fair use / 个人使用范畴 |
| 把封面**下载进仓库或安装包**再分发 | ❌ 高风险：等于再分发受版权保护的图片，且违反 CC BY-SA 的署名/相同方式共享要求 |
| 把工具部署成公开站点供他人访问 | ⚠️ 中高风险：需要署名 + 来源标注，且可能被权利人要求下架；同时「不得将平台数据提供给第三人」条款也适用 |
| 商业用途 | ❌ 明确禁止（站点自身内容亦「未经许可，不得用于商业目的」） |

**落地建议**：默认**只缓存 URL、不缓存图片字节**；UI 上标注「封面来自 Bangumi」；不把任何封面写进 git；如做公开部署需重新评估。

### 4.4 其他风险

- **可用性**：单点依赖 `api.bgm.tv` + `lain.bgm.tv`（均在 Cloudflare 后），无 SLA；断网/被墙时必须降级为无图，不能报错。
- **数据漂移**：条目可能被删除（404）、封面可能被替换。缓存 30 天后过期即可。
- **NSFW**：本地 50,838 条 `nsfw=true`，其封面可能不宜直接展示，建议默认模糊/占位。
- **`bgm.tv` robots**：`/pic/` 被 disallow，说明站方不希望被批量抓图；这也侧面支持"不要预抓"的结论。

---

## 5. 推荐落地架构

### 5.1 数据流

```
浏览器 (ResultList, 50 卡片)
   │  1) tRPC subject.search  → 立即返回文字信息（无封面）
   │  2) tRPC subject.covers({ ids: number[] })  ← 视口内的 id（≤50）
   ▼
Next.js server
   ├─ CoverCache（独立 SQLite 文件 .cache/covers.db）
   │    命中 → 直接返回 URL（0 外部请求）
   │    未命中 → 进入队列
   ├─ 并发闸门（semaphore=5）+ 去重（in-flight Map<id, Promise>）
   │    GET https://api.bgm.tv/v0/subjects/{id}
   │      UA: bgm-filter/0.1 (local tool; contact: …)
   │      timeout 5s；429/5xx → 退避 2s 重试 1 次
   │    解析 images（空串 → 记为 none）
   ▼
返回 Record<id, {grid,small,common} | null>
   ▼
浏览器 <img src="https://lain.bgm.tv/r/200/…" loading="lazy" decoding="async">
   （直连 CDN，无 CORS/防盗链问题；失败 → onError 换成占位块）
```

### 5.2 缓存设计（关键：**不要放进 `Subject` 表**）

`scripts/import-dump.mjs` 每次运行都会 `DELETE FROM "Subject"/"Tag"/"SubjectTag"`（L146–148），把封面字段加在 `Subject` 上会在**重导入时全部丢失**。因此用**独立缓存文件**：

```sql
-- .cache/covers.db  （加入 .gitignore，与 prisma/dev.db 解耦）
CREATE TABLE IF NOT EXISTS cover_cache (
  subject_id  INTEGER PRIMARY KEY,
  grid        TEXT,          -- /r/100
  small       TEXT,          -- /r/200
  common      TEXT,          -- /r/400
  status      TEXT NOT NULL, -- ok | none（确认无封面）| error（可重试）
  fetched_at  INTEGER NOT NULL
);
```

- 用 Node 内置 `node:sqlite`（本项目 Node v27 已支持，本次调研即用它读库），**无需 `pnpm add`、无需 Prisma 迁移**。
- `status=none` 也要落库，避免对空封面条目反复请求（实测最新书籍 80% 是空封面）。
- TTL：`ok` 30 天，`none` 7 天，`error` 1 小时后可重试。

### 5.3 接口契约建议

```ts
// subject.covers —— 批量，幂等，永不抛错
input:  { ids: number[] }            // max 50，去重
output: Record<number, {
  grid: string; small: string; common: string;
} | null>                            // null = 无封面/失败 → 前端占位
```

- **永不因外部 API 失败而让整页报错**：捕获所有异常，返回 `null`。
- 熔断：连续 5 次失败 → 60 s 内直接返回 `null`，不再打外部请求。
- 限流：进程级 `p-limit` 式信号量（自己写 20 行即可，别加依赖），全局 ≤2 req/s。

### 5.4 前端

- 项目**未使用 `next/image`**（`next.config.ts` 明确注释），直接 `<img>` 即可，**无需配置 `remotePatterns`**。
- 属性：`loading="lazy"`、`decoding="async"`、`referrerPolicy="no-referrer"`（实测无 Referer 也能取到；减少信息泄露）。
- 尺寸：网格卡片用 `grid`(100px)，2× DPR 屏用 `small`(200px)；详情/悬浮预览用 `common`(400px)。
- 占位：固定宽高比 `aspect-[2/3]` + 灰底，避免 CLS；`onError` 时替换为占位块并移除 `src`（避免无限重试）。
- NSFW：`subject.nsfw === true` 时默认不请求封面（或显示模糊占位），点击后再加载。

### 5.5 可选：热门条目预热（方案 B 的变体）

本地 `rank IS NOT NULL` 的条目仅 **43,604** 条（占总量的 6.2%），而这些正是默认排序下最常出现在首屏的条目。以 1 req/s 预热约 **12.1 小时**（一次性、可断点续跑、可放夜间），即可让绝大多数首屏"零延迟"。**这不是全量预抓，成本与合规都可接受。** 需用户显式同意后才做。

### 5.6 图片**不需要**落盘：页面直接指向 `lain.bgm.tv` 即可

**可以，而且这是推荐做法。** 浏览器里一个普通 `<img>` 就能显示，服务端不中转、不存字节、不占带宽：

```tsx
<img
  src="https://lain.bgm.tv/r/200/pic/cover/l/60/d8/62229_5Yt0j.jpg"
  alt={subject.name}
  loading="lazy"
  decoding="async"
  referrerPolicy="no-referrer"
  className="aspect-[2/3] w-full rounded object-cover"
  onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
/>
```

实测依据（I12）：带 `Referer: http://127.0.0.1:3080/`、Chrome UA、`Sec-Fetch-Dest: image` 的请求 → `200 image/jpeg`、`cf-cache-status: HIT`、`access-control-allow-origin: *`。即**真实页面热链可行**，没有防盗链、没有 UA 校验、没有 CORS 障碍（`<img>` 本来也不受 CORS 限制）。项目当前**未配置 CSP**（`next.config.ts` 无 `headers()`），不存在 `img-src` 阻断；若日后加 CSP，需放行 `img-src https://lain.bgm.tv`。

**但要说清楚"不下载"≠"不联网"**：图片字节可以不落盘，**URL 仍必须先从 API 解析一次**（文件名是随机 hash，推不出来，见 §2.7b）。所以最少仍需要「每条一次 `GET /v0/subjects/{id}`」，只是把结果里的 3 个 URL 存下来即可，不碰图片本身。

| 关注点 | 结论 |
| --- | --- |
| 防盗链 | ❌ 无（第三方 Referer 与无 Referer 字节完全一致） |
| 跨域 | 不需要——`<img>` 不受 CORS 约束；`/r/*` 还额外给了 `ACAO: *` |
| 混合内容 | 无问题：图片是 `https`，本地页面是 `http` 也能加载 |
| 浏览器缓存 | `cache-control: max-age=691200, immutable`（8 天），二次浏览几乎 0 请求 |
| 首屏流量 | 50 张 `/r/100` ≈ 235 KB；`/r/200` ≈ 700 KB |
| 离线/断网 | 不可用 → 必须 `onError` 降级为占位块，不能出现裂图 |
| 隐私 | 用户浏览器会直连 Bangumi（暴露 IP）；`referrerPolicy="no-referrer"` 可减少信息泄露 |
| 稳定性 | 无 SLA，图片可能被删改 → 必须有 `onError` 兜底 |
| 版权 | 热链**不等于**免责：公开部署仍是「向第三人提供平台数据」，个人自用风险最低 |

**什么时候才需要落盘？** 只有两种情况：① 要求完全离线可用；② 需要避免用户直连 Bangumi。此时再按 `md5(id)` 分桶缓存 `/r/200`（全库约 9.8 GB），属可选项，不是首版必需。

---

## 6. 需要用户决策的点

| # | 决策 | 选项 | 建议 |
| --- | --- | --- | --- |
| 1 | 本地工具是否允许**联网** | 始终联网 / 默认关闭、手动开启 / 完全离线 | 默认开启但**失败静默降级**，加一个 `COVER_ENABLED` 环境变量开关 |
| 2 | 缓存**URL** 还是连**图片字节**一起落盘 | 仅 URL（≈0 体积）/ 图片落盘（+3.3–9.8 GB，可离线） | **仅 URL**；如要离线再单开"下载当前页图片" |
| 3 | 首屏策略 | 阻塞等封面 / 先出文字后补图 | **先出文字后补图**（感知延迟最低） |
| 4 | 限速参数 | 并发 3 / 5 / 8 | **并发 5、全局 ≤2 req/s**（额度占用 <1%） |
| 5 | 是否预热热门 43,604 条 | 是 / 否 | 先不做，观察实际使用后再定 |
| 6 | NSFW 封面 | 直接显示 / 模糊 / 不加载 | **默认不加载**（本地有 50,838 条 NSFW） |
| 7 | 署名与来源标注 | 卡片角标 / 关于页说明 | 至少在页脚注明「封面来自 Bangumi，版权归原作者」 |
| 8 | 缓存 TTL | 7 / 30 / 90 天 | **30 天**（与 CDN `max-age` 对齐） |
| 9 | 图片投递方式 | 浏览器热链 `lain.bgm.tv` / 服务端代理 | **热链**（0 带宽 0 磁盘，见 §5.6）；代理仅在需要隐藏用户 IP 或做图片处理时才考虑 |

---

## 7. 未能验证的项（不编造）

1. **生产环境真实限流阈值**：源码默认 3000/10min + 1h 封禁，但可被环境变量覆盖，Cloudflare 是否另有规则未知。**未主动触发 429**（会换来 1 小时封禁，代价过高），429 响应体与"无 Retry-After"来自源码阅读，非实测。
2. **429 的实际响应头/是否带 `Retry-After`**：同上，未实测。
3. **请求库默认 UA（如 `curl/8.5.0`、`node`）在回源时是否被拒**：只验证了「完全无 UA → 403」与「自定义 UA → 200」；curl 默认 UA 的那次请求命中了 CDN 缓存（200），**不能证明它可用**。文档只说"可能会被禁用"。
4. **700,108 条的真实封面覆盖率**：仅抽样 100 条（5 个 20 条页面）。观察到强偏斜——按 `rank` 排序的热门页 0/100 缺图，按 `date` 排序的最新书籍 16/20 缺图。全库真实比例未知，**建议实现时按 70–85% 有图估算**。
5. **归档 id 在 bgm.tv 的删除率（404 率）**：未对本地 id 做抽样校验（避免额外请求）；单条 404 形态已确认（P6）。
6. **`images` 是否可能为 `null`**：抽样中"无封面"一律是空字符串对象，未见 `null`；但 OpenAPI 的 `Images` 未标 nullable，实际行为以空串为准，代码两种都要判。
7. **`lain.bgm.tv` 的 robots.txt / 使用条款**：请求返回 **500**（`Not Found` 文本），无有效 robots 声明；该域名的独立条款未找到。
8. **第三方镜像/代理的可靠性**：**刻意未测**（合规与安全考量），故不对其可用性下任何结论。
9. **大并发下的真实吞吐**：只做了 10 个 CDN 并发（91 ms）与 8 次串行 API 请求；未做 API 并发压测（避免触发限流）。
10. **`/v0/subjects` 列表接口 `total` 的口径**：与本地数据差异巨大（type=3：7,994 vs 101,230），未查明原因（可能只统计有排名的条目），故不用于任何容量推算。

---

## 附录 A：复现命令

```bash
UA='bgm-filter-research/0.1 (https://github.com/example/bgm-filter; contact: dev@example.com)'

# 1) UA 对照：强制回源才看得到 403
curl -sS -H 'User-Agent:' -D - -o /dev/null "https://api.bgm.tv/v0/subjects/1?cb=$RANDOM"   # → 403
curl -sS -A "$UA"       -D - -o /dev/null "https://api.bgm.tv/v0/subjects/1?cb=$RANDOM"      # → 200

# 2) images 结构
curl -sS -A "$UA" https://api.bgm.tv/v0/subjects/62229 | jq '.images'

# 3) 图片直链（无 Referer 也 200）
curl -sS -o /dev/null -w '%{http_code} %{content_type} %{size_download}\n' \
  'https://lain.bgm.tv/r/400/pic/cover/l/60/d8/62229_5Yt0j.jpg'

# 4) 防盗链对照（两者字节数相同）
curl -sS -o /dev/null -w '%{size_download}\n' -e 'https://bgm.tv/subject/1' 'https://lain.bgm.tv/r/400/pic/cover/l/60/d8/62229_5Yt0j.jpg'
curl -sS -o /dev/null -w '%{size_download}\n' -e 'https://evil.example/'     'https://lain.bgm.tv/r/400/pic/cover/l/60/d8/62229_5Yt0j.jpg'

# 5) 批量能力否决证据
curl -sS -A "$UA" -X POST -H 'Content-Type: application/json' \
  -d '{"keyword":"love"}' 'https://api.bgm.tv/v0/search/subjects?limit=100&offset=0' \
  | jq '{limit,total,n:(.data|length)}'      # → limit=20, total=1000, n=20

# 6) 页面无 og:image
curl -sS -A 'Mozilla/5.0' https://bgm.tv/subject/1 | grep -c 'og:'   # → 0
```

## 附录 B：原始证据落点

`/tmp/cover-research/`（临时目录，不随仓库提交）：

| 文件 | 内容 |
| --- | --- |
| `hdr_*.txt` | 各次请求的完整响应头（含 `cf-cache-status`、`cache-control`） |
| `body_noua.json` / `body_c_noua.json` | 无 UA 的 200（缓存命中）与 403（回源）对照 |
| `body_62229.json` / `body_1630.json` | `images` 结构原始样本 |
| `body_books.json` | 最新 20 本书，16 条空封面 |
| `body_search.json` / `body_search100.json` / `body_search1000.json` | 搜索分页上限证据 |
| `body_html.html` / `body_html_game.html` | 两个条目页 HTML，`og:` 计数为 0 |
| `img_*.jpg` | 实际下载的封面（含 100/400 尺寸） |
| `rate-limit.go` / `ban.lua` / `v0.yaml` | 官方限流实现与 OpenAPI 规范原文 |

---

*本文只做可行性论证，未改动 `src/**`、`scripts/**`、`package.json`、`prisma/**`。落地实现需另行评审。*
