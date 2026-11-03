# 数据导入报告（S2 · data-engineer）

> 本文由 `scripts/import-dump.mjs` 在导入结束时自动生成（机器口径），文末「验证记录」为导入后实测追加。
> 生成时间：2026-11-03T09:39:31.324Z　|　平台：linux x64　|　Node：v27.0.0-alpha.0.0.0

## 1. 结论

| 指标 | 实测 | 目标 / 基线 | 结果 |
| --- | --- | --- | --- |
| 导入耗时 | 19.5 s | ≤ 300 s | ✅ |
| dev.db 体积 | 311.8 MB | ≤ 600 MB | ✅ |
| Subject 总数 | 700,108 | 700,108 | ✅ |
| Tag 去重数（nameLower） | 91,909 | 91,909 | ✅ |
| SubjectTag 总数 | 2,267,357 | 2,267,357（推导值） | ✅ |
| 跳过行数 | 0 | 0 | ✅ |

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
| 第一遍扫描（700,108 行，标签统计） | 4.7 s |
| 写入 Tag（91,909 个） | 0.2 s |
| 第二遍扫描（写 700,108 条目 / 2,267,357 关联） | 14.2 s |
| 恢复 PRAGMA + ANALYZE | 0.3 s |
| **合计** | **19.5 s** |

- 批量事务：每 2,000 个 Subject 一个事务（约 12,000 条 SubjectTag/事务），prepared statement 复用。
- 导入期 PRAGMA：`journal_mode=WAL`、`synchronous=OFF`、`foreign_keys=OFF`、`cache_size=-262144`(256 MiB)、`temp_store=MEMORY`。
- 收尾：`foreign_keys=ON` → `journal_mode=DELETE` → `ANALYZE`（必须，否则查询计划退化）。
- VACUUM：未执行（VACUUM 前 311.8 MB，未超 480 MB 阈值）。

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
- **字段映射**：`year = /^(\d{4})/`；`scoreVotes = Σ score_details`；`rank = rank > 0 ? rank : null`；`tagsJson` 原顺序取前 10 个 `{name,count}`；`metaTagsJson` 原样。
- **日期归一**：dump 中 53,871 条日期为空字符串 `""`（无 `null`），入库统一规范为 `NULL`，因此 `date IS NULL = 53,871`、`year IS NULL = 53,871`；前端展示逻辑不受影响。
- **幂等**：每次运行先 `DELETE FROM "SubjectTag"/"Tag"/"Subject"`，并重置 `sqlite_sequence` 中 Tag 的序列，重复导入计数与 Tag.id 均稳定；表/索引结构完全由 `prisma db push` 决定，脚本无任何 DDL。
- **风险**：`VACUUM` 需≈DB 体积的临时磁盘；`ANALYZE` 在 470 万行库上约十几秒，属预期成本。

## 6. 验证记录

见下节（导入后执行 `node --env-file=.env scripts/verify-db.mjs --write-report` 生成 §7 实测校验）。

> 注意：重跑导入会整体重写本文，§7 的实测校验区块需重新生成；「关联数口径说明」已内置在生成模板中，不会因重跑而回退。
