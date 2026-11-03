/**
 * 测试专用：用 `node:sqlite` 建一个与 Prisma schema 等价的临时 SQLite 库。
 *
 * 仅供 vitest 使用，不会被应用代码 import。每个 fixture 使用独立临时目录，
 * 测试结束调用 `cleanup()` 删除，绝不触碰 `prisma/dev.db`。
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface FixtureUserTag {
  name: string;
  count?: number;
}

export interface FixtureSubject {
  id: number;
  type: number;
  name: string;
  nameCn?: string | null;
  date?: string | null;
  year?: number | null;
  score?: number;
  scoreVotes?: number;
  rank?: number | null;
  nsfw?: boolean;
  favorite?: Record<string, number> | null;
  userTags?: FixtureUserTag[];
  metaTags?: string[];
}

export interface TestDatabase {
  /** SQLite 文件绝对路径。 */
  path: string;
  /** 临时目录（cleanup 时整体删除）。 */
  dir: string;
  cleanup: () => void;
}

const SCHEMA_SQL = `
CREATE TABLE "Subject" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "type" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "nameCn" TEXT,
  "date" TEXT,
  "year" INTEGER,
  "score" REAL NOT NULL DEFAULT 0,
  "scoreVotes" INTEGER NOT NULL DEFAULT 0,
  "rank" INTEGER,
  "nsfw" BOOLEAN NOT NULL DEFAULT false,
  "favoriteJson" TEXT,
  "tagsJson" TEXT,
  "metaTagsJson" TEXT
);
CREATE INDEX "Subject_type_idx" ON "Subject"("type");
CREATE INDEX "Subject_year_idx" ON "Subject"("year");
CREATE INDEX "Subject_score_idx" ON "Subject"("score");
CREATE INDEX "Subject_type_score_idx" ON "Subject"("type", "score");

CREATE TABLE "Tag" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL,
  "nameLower" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX "Tag_nameLower_key" ON "Tag"("nameLower");

CREATE TABLE "SubjectTag" (
  "subjectId" INTEGER NOT NULL,
  "tagId" INTEGER NOT NULL,
  PRIMARY KEY ("subjectId", "tagId")
);
CREATE INDEX "SubjectTag_tagId_subjectId_idx" ON "SubjectTag"("tagId", "subjectId");
`;

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "bgm-filter-test-"));
}

/**
 * 创建 fixture 库并写入条目 / 标签 / 关联。
 *
 * 标签从每个条目的 `userTags` / `metaTags` 自动派生：`Tag.name` 取首次出现的写法，
 * `Tag.count` = 含该标签的条目数（与导入脚本语义一致）。
 */
export function createTestDatabase(subjects: FixtureSubject[]): TestDatabase {
  const dir = makeTempDir();
  const path = join(dir, "test.db");
  const database = new DatabaseSync(path);

  database.exec(SCHEMA_SQL);

  const insertSubject = database.prepare(`
    INSERT INTO "Subject"
      ("id", "type", "name", "nameCn", "date", "year", "score", "scoreVotes", "rank", "nsfw", "favoriteJson", "tagsJson", "metaTagsJson")
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTag = database.prepare(
    `INSERT INTO "Tag" ("name", "nameLower", "count") VALUES (?, ?, ?)`,
  );
  const insertSubjectTag = database.prepare(
    `INSERT INTO "SubjectTag" ("subjectId", "tagId") VALUES (?, ?)`,
  );

  /** nameLower → { id, name } */
  const tagIndex = new Map<string, { id: number; name: string }>();
  /** 每个标签出现的条目 id（去重后计数）。 */
  const tagSubjects = new Map<string, Set<number>>();

  database.exec("BEGIN");
  try {
    for (const subject of subjects) {
      const userTags = (subject.userTags ?? []).map((entry) => ({
        name: entry.name,
        count: entry.count ?? 1,
      }));
      const metaTags = subject.metaTags ?? [];
      const favoriteJson = subject.favorite ? JSON.stringify(subject.favorite) : null;

      insertSubject.run(
        subject.id,
        subject.type,
        subject.name,
        subject.nameCn ?? null,
        subject.date ?? null,
        subject.year ?? null,
        subject.score ?? 0,
        subject.scoreVotes ?? 0,
        subject.rank ?? null,
        subject.nsfw ? 1 : 0,
        favoriteJson,
        userTags.length > 0 ? JSON.stringify(userTags) : null,
        metaTags.length > 0 ? JSON.stringify(metaTags) : null,
      );

      const names = new Map<string, string>();
      for (const entry of userTags) {
        const lower = entry.name.toLowerCase();
        if (!names.has(lower)) names.set(lower, entry.name);
      }
      for (const name of metaTags) {
        const lower = name.toLowerCase();
        if (!names.has(lower)) names.set(lower, name);
      }

      for (const [lower, name] of names) {
        if (!tagIndex.has(lower)) {
          const result = insertTag.run(name, lower, 0);
          const tagId = Number(result.lastInsertRowid);
          tagIndex.set(lower, { id: tagId, name });
          tagSubjects.set(lower, new Set());
        }
        const subjectSet = tagSubjects.get(lower);
        const tag = tagIndex.get(lower);
        if (subjectSet && tag) subjectSet.add(subject.id);
      }
    }

    for (const [lower, subjectSet] of tagSubjects) {
      const tag = tagIndex.get(lower);
      if (!tag) continue;
      for (const subjectId of subjectSet) {
        insertSubjectTag.run(subjectId, tag.id);
      }
    }

    const updateCount = database.prepare(`UPDATE "Tag" SET "count" = ? WHERE "id" = ?`);
    for (const [lower, subjectSet] of tagSubjects) {
      const tag = tagIndex.get(lower);
      if (tag) updateCount.run(subjectSet.size, tag.id);
    }

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    database.close();
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }

  database.close();

  return {
    path,
    dir,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** 创建一个没有任何表的空库（模拟「数据库未导入」）。 */
export function createEmptyDatabase(): TestDatabase {
  const dir = makeTempDir();
  const path = join(dir, "empty.db");
  writeFileSync(path, "");
  return {
    path,
    dir,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
