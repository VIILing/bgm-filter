# 数据导入报告（S2 · data-engineer）

> 本文由 `scripts/import-dump.mjs` 在导入结束时自动生成（机器口径），文末「验证记录」为导入后实测追加。
> 生成时间：2026-11-03T13:14:39.969Z　|　平台：linux x64　|　Node：v27.0.0-alpha.0.0.0

## 1. 结论

| 指标 | 实测 | 目标 / 基线 | 结果 |
| --- | --- | --- | --- |
| 导入耗时 | 27.3 s | ≤ 300 s | ✅ |
| dev.db 体积 | 740.2 MB | ≤ 600 MB | ❌ |
| Subject 总数 | 700,108 | 700,108 | ✅ |
| Tag 去重数（nameLower） | 91,909 | 91,909 | ✅ |
| SubjectTag 总数 | 2,267,357 | 2,267,357（推导值） | ✅ |
| 跳过行数 | 0 | 0 | ✅ |
| summary 非空 / 为 NULL | 575,804 / 124,304 | 575,804（dump 非空） | ✅ |

> **体积口径变化（summary 入库）**：本次 `Subject.summary` 全量入库且**不截断**——非空 575,804 条、原文 362.9 MB（UTF-8 均值 661 B，最长 15,130 字符，id=649507），dev.db 因此较加列前明显增大；§1 的「≤ 600 MB」目标是 summary 入库前设定的阈值，现口径下不再适用，**不代表导入异常**（三表计数与基线仍逐项一致）。

> **关联数口径说明（重要）**：本文的「SubjectTag 总数」= Σ 每条目 `tags ∪ meta_tags` 按 `nameLower` 去重后的集合大小，即 2,267,357 行——**不是** `tags[]` 与 `meta_tags[]` 的原始条目之和。推导：`tags[]` 原始 1,929,772 条 + `meta_tags[]` 原始 801,257 条 = 2,731,029，减去条目内 `tags` 自身重复 66 条、`meta_tags` 与 `tags` 重复 463,606 条 → **2,267,357**；该值与独立扫描 dump 的结果、`COUNT(*) FROM "SubjectTag"`、`SUM(Tag.count)` 三方一致。原 `requirements.md` / `architecture.md` / `team-plan.md` 中「>4,000,000 / 约 500 万」是按「每条目约 10 个标签」估算的，与 dump 实际分布不符（`tags` 数组长度 0–11、均值 2.76，且大量条目标签很少），**该预估有误，以实测 2,267,357 为准**。

- 数据源：`/home/ubuntu/bgm-filter/dump-db/subject.jsonlines`（947.7 MB，700,108 行，UTF-8）
- 数据库：`/home/ubuntu/bgm-filter/prisma/dev.db`
- 完整性：`PRAGMA integrity_check` → ok；`PRAGMA foreign_key_check` → 无违规；收尾 `journal_mode` → delete
- 主键范围：Subject id 1–716,693；Tag id 1–91909
- 年份范围：701–2069（含 `0701` → 701 之类的预期脏数据）

## 2. 耗时分解

| 阶段 | 耗时 |
| --- | --- |
| 清空旧数据（幂等） | 0.2 s |
| 第一遍扫描（700,108 行，标签统计） | 4.8 s |
| 写入 Tag（91,909 个） | 0.2 s |
| 第二遍扫描（写 700,108 条目 / 2,267,357 关联） | 19.5 s |
| VACUUM + 恢复 PRAGMA + ANALYZE | 2.5 s |
| **合计** | **27.3 s** |

- 批量事务：每 2,000 个 Subject 一个事务（约 12,000 条 SubjectTag/事务），prepared statement 复用。
- 导入期 PRAGMA：`journal_mode=WAL`、`synchronous=OFF`、`foreign_keys=OFF`、`cache_size=-262144`(256 MiB)、`temp_store=MEMORY`。
- 收尾：`foreign_keys=ON` → `journal_mode=DELETE` → `ANALYZE`（必须，否则查询计划退化）。
- VACUUM：已执行（VACUUM 前 754.0 MB）。

## 3. 三表计数

| 表 | 行数 |
| --- | --- |
| Subject | 700,108 |
| Tag | 91,909 |
| SubjectTag | 2,267,357 |

第一遍扫描口径的其它统计：

| 指标 | 数值 |
| --- | --- |
| 有标签（tags ∪ meta_tags）条目 | 422,912 |
| 仅 tags / 仅 meta_tags / 两者都有 / 都没有 | 187,680 / 74,376 / 160,856 / 277,196 |
| 条目×标签关联（条目内已去重） | 2,267,357 |
| nsfw = true | 50,838 |
| rank 非空 | 43,604 |
| year 为 null | 53,871 |
| summary 非空 / 为 NULL | 575,804 / 124,304 |
| summary 原文体积（UTF-8）/ 字符数 / 最长 | 362.9 MB / 168,734,629 / 15,130 字符 |

## 4. 与基线逐项核对

| 项 | 实测 | 基线 | 结果 |
| --- | --- | --- | --- |
| Subject 总数 | 700,108 | 700,108 | ✅ |
| type 1（漫画） | 422,971 | 422,971 | ✅ |
| type 2（动画） | 31,258 | 31,258 | ✅ |
| type 3（音乐） | 101,230 | 101,230 | ✅ |
| type 4（游戏） | 117,881 | 117,881 | ✅ |
| type 6（三次元） | 26,768 | 26,768 | ✅ |
| score > 0 | 287,448 | 287,448 | ✅ |
| date 为 null | 53,871 | 53,871 | ✅ |
| Tag 去重（nameLower） | 91,909 | 91,909 | ✅ |
| SubjectTag 总数 | 2,267,357 | 2,267,357（推导值） | ✅ |
| 标签「科幻」条目数 | 7,331 | 7,331 | ✅ |
| 标签「百合」条目数 | 8,084 | 8,084 | ✅ |
| 标签「r18」条目数（任意大小写） | 24,415 | 24,415 | ✅ |
| 标签「galgame」条目数 | 16,241 | 16,241 | ✅ |

> 说明：任务书给的 SubjectTag 预期是「≥4,000,000」，实测达不到，原因是 dump 本身没有那么多标签记录（见 §4.1）。该值不是导入丢数据：4 个抽查标签条目数与基线完全一致，且 `SUM(Tag.count) = COUNT(SubjectTag)`。

### 4.1 SubjectTag 总量为什么是 2,267,357

对 700,108 行原始 JSONL 全量计数（独立扫描与导入脚本第一遍结果一致）：

| 项 | 数量 |
| --- | --- |
| `tags[]` 原始条目 | 1,929,772 |
| `meta_tags[]` 原始条目 | 801,257 |
| 原始合计 | 2,731,029 |
| 减：条目内 `tags` 自身重复（nameLower） | −66 |
| 减：条目内 `meta_tags` 与 `tags` 重复（nameLower） | −463,606 |
| = 去重后条目×标签关联 = SubjectTag 行数 | **2,267,357** |

- dump 的 `tags` 是「每条目热门标签」，数组长度 0–11，均值 2.76；`meta_tags` 与 `tags` 大量重叠（463,606 条），说明「tags ∪ meta_tags 按 nameLower 去重」是必要规则；
- 2,731,029 是这份 dump 的物理上限，去重后 2,267,357。所以 4,000,000+ 的预期不成立，**不是导入丢数据**；
- 交叉校验：`SUM(Tag.count)` = 2,267,357；`SUM(Tag.id * Tag.count)` = `SUM(SubjectTag.tagId)` = 93077949424（完全相等）。

## 5. 实现要点

- **两遍扫描**（`readline` + `createReadStream`，内存与行数解耦）：
  1. 第一遍：统计每个 `nameLower` 的条目数（条目内 tags ∪ meta_tags 先去重）与每种原始写法的出现条目数；同时统计类型分布、score/date/rank 等。
  2. 写 Tag（规范名 + count），再第二遍写 Subject 与 SubjectTag。
- **规范名**：同一 `nameLower` 取出现条目数最多的原始写法，并列取字典序最小（JS 字符串比较 = UTF-16 码元序）；`Tag.count` = 含该标签的条目数。
- **字段映射**：`year = /^(\d{4})/`；`scoreVotes = Σ score_details`；`rank = rank > 0 ? rank : null`；`tagsJson` 原顺序取前 10 个 `{name,count}`；`metaTagsJson` 原样；`summary` 原样入库（仅「非空字符串」保留，空串/缺失 → `NULL`，**不截断**，最长 15,130 字符，id=649507）。
- **日期归一**：dump 中 53,871 条日期为空字符串 `""`（无 `null`），入库统一规范为 `NULL`，因此 `date IS NULL = 53,871`、`year IS NULL = 53,871`；前端展示逻辑不受影响。
- **幂等**：每次运行先 `DELETE FROM "SubjectTag"/"Tag"/"Subject"`，并重置 `sqlite_sequence` 中 Tag 的序列，重复导入计数与 Tag.id 均稳定；表/索引结构完全由 `prisma db push` 决定，脚本无任何 DDL。
- **风险**：`VACUUM` 需≈DB 体积的临时磁盘；`ANALYZE` 在 470 万行库上约十几秒，属预期成本。

## 6. 验证记录

见下节（导入后执行 `node --env-file=.env scripts/verify-db.mjs --write-report` 生成 §7 实测校验）。

> 注意：重跑导入会整体重写本文，§7 的实测校验区块需重新生成；「关联数口径说明」已内置在生成模板中，不会因重跑而回退。

<!-- VERIFY:BEGIN 由 scripts/verify-db.mjs 生成，勿手工编辑本区块 -->
## 7. 数据库实测校验（node:sqlite）

> 命令：`node --env-file=.env scripts/verify-db.mjs --write-report`
> 执行时间：2026-11-03T13:15:21.068Z　|　库：`/home/ubuntu/bgm-filter/prisma/dev.db`（740.2 MB）

### 7.1 基线核对

| 项 | 实测 | 基线 | 结果 |
| --- | --- | --- | --- |
| Subject 总数 | 700,108 | 700,108 | ✅ |
| type 1 | 422,971 | 422,971 | ✅ |
| type 2 | 31,258 | 31,258 | ✅ |
| type 3 | 101,230 | 101,230 | ✅ |
| type 4 | 117,881 | 117,881 | ✅ |
| type 6 | 26,768 | 26,768 | ✅ |
| score > 0 | 287,448 | 287,448 | ✅ |
| date IS NULL | 53,871 | 53,871 | ✅ |
| year IS NULL | 53,871 | 53,871 | ✅ |
| Tag 去重（nameLower） | 91,909 | 91,909 | ✅ |
| SubjectTag 总数 | 2,267,357 | 2,267,357（推导值）<br>任务书预期 ≥4,000,000 → 不成立 | ✅ |
| 标签「科幻」条目数 | 7,331 | 7,331 | ✅ |
| 标签「百合」条目数 | 8,084 | 8,084 | ✅ |
| 标签「r18」条目数（任意大小写） | 24,415 | 24,415 | ✅ |
| 标签「galgame」条目数 | 16,241 | 16,241 | ✅ |

`rank > 0` = 43,604，`nsfw = 1` = 50,838（与 team-plan §2 的 43,604 / 50,838 一致）。

### 7.2 一致性与映射抽查

| 检查项 | 计数 | 结果 |
| --- | --- | --- |
| SubjectTag 重复 (subjectId,tagId) | 0 | ✅ |
| Tag.count 与 SubjectTag 实际行数不一致的 Tag | 0 | ✅ |
| SubjectTag 孤儿（无 Subject） | 0 | ✅ |
| SubjectTag 孤儿（无 Tag） | 0 | ✅ |
| tagsJson 超过 10 项 | 0 | ✅ |
| tagsJson/metaTagsJson 非法 JSON | 0 | ✅ |
| date 非空但 year 为 null | 0 | ✅ |
| year 与 date 前 4 位不一致 | 0 | ✅ |
| rank = 0 未转 null | 0 | ✅ |
| score = 0 但 scoreVotes > 0 | 0 | ✅ |
| Tag.name ≠ nameLower（设计如此，非缺陷） | 12,716 | ℹ️（预期非 0） |

大小写规范名抽查（`Tag.nameLower` 合并后只保留一个规范展示名）：

| nameLower | 规范名 | Tag.count | SubjectTag 行数 | 一致 |
| --- | --- | --- | --- | --- |
| galgame | Galgame | 16,241 | 16,241 | ✅ |
| r18 | R18 | 24,415 | 24,415 | ✅ |
| pc | PC | 83,344 | 83,344 | ✅ |
| vocaloid | Vocaloid | 4,837 | 4,837 | ✅ |
| c&c | C&C | 11 | 11 | ✅ |

有 SubjectTag 的 Tag 数 = 91,909 / 91,909（全量）。

### 7.3 查询性能抽查（5 次取中位数）

| 查询 | 返回 | 中位耗时 | 目标 | 结果 |
| --- | --- | --- | --- | --- |
| 计数：科幻 & 百合（AND）+ 2000–2020 + 类型(动画/游戏) | count=53 | 0.7 ms | < 300 ms | ✅ |
| 分页：同条件 ORDER BY (score=0), score DESC, id ASC LIMIT 50 | 50 行 | 0.7 ms | < 300 ms | ✅ |
| 单标签 + 年代：科幻 & 2010–2020 首页 | 50 行 | 6.5 ms | < 300 ms | ✅ |
| 大标签 + 年代 + 类型：PC & 2010–2020 & 游戏，计数 | count=26,344 | 46.0 ms | < 300 ms | ✅ |
| 大标签 AND：PC & 日本，计数（交集量大） | count=217 | 6.1 ms | < 300 ms | ✅ |
| 取反：!R18 + 2000–2020，计数（EXCEPT 全表） | count=359,759 | 292.4 ms | < 300 ms | ✅ |
| 标签联想：nameLower LIKE 'gal%' ORDER BY count DESC LIMIT 20 | 20 行 | 3.6 ms | < 300 ms | ✅ |
| 头部统计：按类型分组计数 | 5 行 | 17.2 ms | < 300 ms | ✅ |
| 名称搜索：LIKE '%攻壳%'（无索引，全表扫描） | count=41 | 156.7 ms | < 300 ms | ✅ |
| 纯评分排序首页（无标签条件） | 50 行 | 38.5 ms | < 300 ms | ✅ |

EXPLAIN QUERY PLAN 要点：

- **计数：科幻 & 百合（AND）+ 2000–2020 + 类型(动画/游戏)**
  `SEARCH s USING INTEGER PRIMARY KEY (rowid=?) | LIST SUBQUERY 4 | MERGE (INTERSECT) | LEFT | SEARCH t USING COVERING INDEX Tag_nameLower_key (nameLower=?) | SEARCH st USING COVERING INDEX SubjectTag_tagId_subjectId_idx (tagId=?) | RIGHT | SEARCH t USING COVERING INDEX Tag_nameLower_key (nameLower=?) | SEARCH st USING COVERING INDEX SubjectTag_tagId_subjectId_idx (tagId=?)`
- **分页：同条件 ORDER BY (score=0), score DESC, id ASC LIMIT 50**
  `SEARCH s USING INTEGER PRIMARY KEY (rowid=?) | LIST SUBQUERY 4 | MERGE (INTERSECT) | LEFT | SEARCH t USING COVERING INDEX Tag_nameLower_key (nameLower=?) | SEARCH st USING COVERING INDEX SubjectTag_tagId_subjectId_idx (tagId=?) | RIGHT | SEARCH t USING COVERING INDEX Tag_nameLower_key (nameLower=?) | SEARCH st USING COVERING INDEX SubjectTag_tagId_subjectId_idx (tagId=?) | USE TEMP B-TREE FOR ORDER BY`
- **单标签 + 年代：科幻 & 2010–2020 首页**
  `SEARCH s USING INTEGER PRIMARY KEY (rowid=?) | LIST SUBQUERY 1 | SEARCH t USING COVERING INDEX Tag_nameLower_key (nameLower=?) | SEARCH st USING COVERING INDEX SubjectTag_tagId_subjectId_idx (tagId=?) | USE TEMP B-TREE FOR ORDER BY`
- **大标签 + 年代 + 类型：PC & 2010–2020 & 游戏，计数**
  `SEARCH s USING INTEGER PRIMARY KEY (rowid=?) | LIST SUBQUERY 1 | SEARCH t USING COVERING INDEX Tag_nameLower_key (nameLower=?) | SEARCH st USING COVERING INDEX SubjectTag_tagId_subjectId_idx (tagId=?)`
- **大标签 AND：PC & 日本，计数（交集量大）**
  `SEARCH s USING INTEGER PRIMARY KEY (rowid=?) | LIST SUBQUERY 4 | MERGE (INTERSECT) | LEFT | SEARCH t USING COVERING INDEX Tag_nameLower_key (nameLower=?) | SEARCH st USING COVERING INDEX SubjectTag_tagId_subjectId_idx (tagId=?) | RIGHT | SEARCH t USING COVERING INDEX Tag_nameLower_key (nameLower=?) | SEARCH st USING COVERING INDEX SubjectTag_tagId_subjectId_idx (tagId=?)`
- **取反：!R18 + 2000–2020，计数（EXCEPT 全表）**
  `SEARCH s USING INTEGER PRIMARY KEY (rowid=?) | LIST SUBQUERY 3 | MERGE (EXCEPT) | LEFT | SCAN s2 | RIGHT | SEARCH t USING COVERING INDEX Tag_nameLower_key (nameLower=?) | SEARCH st USING COVERING INDEX SubjectTag_tagId_subjectId_idx (tagId=?)`
- **标签联想：nameLower LIKE 'gal%' ORDER BY count DESC LIMIT 20**
  `SCAN Tag | USE TEMP B-TREE FOR ORDER BY`
- **头部统计：按类型分组计数**
  `SCAN Subject USING COVERING INDEX Subject_type_idx`
- **名称搜索：LIKE '%攻壳%'（无索引，全表扫描）**
  `SCAN Subject`
- **纯评分排序首页（无标签条件）**
  `SCAN Subject USING COVERING INDEX Subject_score_idx | USE TEMP B-TREE FOR ORDER BY`

结论：标签集合 + 年代 + 类型的计数/首页查询 10/10 项达标；最慢的是 `!R18` 取反（EXCEPT 需扫描全表），仍在 300 ms 内。名称搜索无索引（`LIKE '%x%'`），走全表扫描，属于已知设计取舍。
<!-- VERIFY:END -->
