import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// @ts-expect-error Node 24 includes node:sqlite; the project still targets @types/node 20.
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const legacySchema = `
PRAGMA foreign_keys=ON;
CREATE TABLE "User" ("id" TEXT NOT NULL PRIMARY KEY);
CREATE TABLE "Subject" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE TABLE "ErrorItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "subjectId" TEXT,
  "originalImageUrl" TEXT NOT NULL,
  "ocrText" TEXT,
  "questionText" TEXT,
  "answerText" TEXT,
  "analysis" TEXT,
  "wrongAnswerText" TEXT,
  "mistakeAnalysis" TEXT,
  "mistakeStatus" TEXT,
  "geogebraCommands" TEXT,
  "source" TEXT,
  "errorType" TEXT,
  "userNotes" TEXT,
  "masteryLevel" INTEGER NOT NULL DEFAULT 0,
  "gradeSemester" TEXT,
  "paperLevel" TEXT,
  "knowledgePoints" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE
);
CREATE TABLE "KnowledgeTag" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "parentId" TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  "code" TEXT,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "userId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY ("parentId") REFERENCES "KnowledgeTag"("id") ON DELETE CASCADE,
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "KnowledgeTag_subject_name_userId_parentId_key"
ON "KnowledgeTag"("subject", "name", "userId", "parentId");
CREATE TABLE "_ErrorItemToKnowledgeTag" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,
  PRIMARY KEY ("A", "B"),
  FOREIGN KEY ("A") REFERENCES "ErrorItem"("id") ON DELETE CASCADE,
  FOREIGN KEY ("B") REFERENCES "KnowledgeTag"("id") ON DELETE CASCADE
);
CREATE TABLE "ReviewSchedule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "errorItemId" TEXT NOT NULL,
  FOREIGN KEY ("errorItemId") REFERENCES "ErrorItem"("id") ON DELETE CASCADE
);
CREATE TABLE "PracticeRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "errorItemId" TEXT,
  "subject" TEXT,
  "difficulty" TEXT,
  "isCorrect" BOOLEAN,
  "answerInput" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  FOREIGN KEY ("errorItemId") REFERENCES "ErrorItem"("id") ON DELETE SET NULL
);
INSERT INTO "User" VALUES ('user-1');
INSERT INTO "Subject" VALUES ('math-1', '数学', 'user-1');
INSERT INTO "ErrorItem" (
  "id", "userId", "subjectId", "originalImageUrl", "questionText", "masteryLevel",
  "knowledgePoints", "createdAt", "updatedAt"
) VALUES ('error-1', 'user-1', 'math-1', 'data:image/png;base64,dGVzdA==', 'question', 9,
  '["Equation","Move"]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "ReviewSchedule" VALUES ('review-1', 'error-1');
INSERT INTO "PracticeRecord" ("id", "userId", "errorItemId", "isCorrect")
VALUES ('record-1', 'user-1', 'error-1', true);
INSERT INTO "KnowledgeTag" ("id", "name", "subject", "isSystem", "createdAt", "updatedAt")
VALUES ('tag-1', 'Shared', 'math', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "KnowledgeTag" ("id", "name", "subject", "isSystem", "createdAt", "updatedAt")
VALUES ('tag-2', 'Shared', 'math', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "_ErrorItemToKnowledgeTag" VALUES ('error-1', 'tag-2');
`;

describe('legacy review data migration', () => {
    it('backfills tags, preserves practice history, and enforces new constraints', () => {
        const directory = mkdtempSync(join(tmpdir(), 'wrong-notebook-migration-'));
        const db = new DatabaseSync(join(directory, 'fixture.db'));
        try {
            db.exec(legacySchema);
            db.exec(readFileSync(resolve('prisma/migrations/20260902090000_remove_legacy_review_data/migration.sql'), 'utf8'));

            const errorColumns = db.prepare('PRAGMA table_info("ErrorItem")').all().map((column: { name: string }) => column.name);
            expect(errorColumns).not.toContain('knowledgePoints');
            expect(db.prepare(`SELECT "name" FROM sqlite_master WHERE "type" = 'table' AND "name" = 'ReviewSchedule'`).get()).toBeUndefined();
            expect(db.prepare('SELECT "masteryLevel" FROM "ErrorItem" WHERE "id" = ?').get('error-1')).toEqual({ masteryLevel: 0 });
            expect(db.prepare('SELECT "errorItemId" FROM "PracticeRecord" WHERE "id" = ?').get('record-1')).toEqual({ errorItemId: 'error-1' });
            expect(db.prepare(`
                SELECT COUNT(*) AS count
                FROM "_ErrorItemToKnowledgeTag" r
                JOIN "KnowledgeTag" t ON t."id" = r."B"
                WHERE r."A" = 'error-1' AND t."name" IN ('Equation', 'Move')
            `).get()).toEqual({ count: 2 });
            expect(db.prepare(`SELECT COUNT(*) AS count FROM "KnowledgeTag" WHERE "name" = 'Shared'`).get()).toEqual({ count: 1 });
            expect(() => db.exec(`UPDATE "ErrorItem" SET "masteryLevel" = 3 WHERE "id" = 'error-1'`)).toThrow();
            expect(() => db.exec(`
                INSERT INTO "KnowledgeTag" ("id", "name", "subject", "isSystem", "createdAt", "updatedAt")
                VALUES ('tag-3', 'Shared', 'math', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `)).toThrow();
        } finally {
            db.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });
});
