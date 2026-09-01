-- Backfill the legacy ErrorItem.knowledgePoints JSON array into relational tags.
CREATE TEMP TABLE "_LegacyKnowledgePoint" AS
SELECT
    e."id" AS "errorItemId",
    e."userId",
    CASE
        WHEN lower(COALESCE(s."name", '')) LIKE '%math%' OR COALESCE(s."name", '') LIKE '%数学%' THEN 'math'
        WHEN lower(COALESCE(s."name", '')) LIKE '%english%' OR COALESCE(s."name", '') LIKE '%英语%' THEN 'english'
        WHEN lower(COALESCE(s."name", '')) LIKE '%physics%' OR COALESCE(s."name", '') LIKE '%物理%' THEN 'physics'
        WHEN lower(COALESCE(s."name", '')) LIKE '%chemistry%' OR COALESCE(s."name", '') LIKE '%化学%' THEN 'chemistry'
        WHEN lower(COALESCE(s."name", '')) LIKE '%biology%' OR COALESCE(s."name", '') LIKE '%生物%' THEN 'biology'
        WHEN lower(COALESCE(s."name", '')) LIKE '%chinese%' OR COALESCE(s."name", '') LIKE '%语文%' THEN 'chinese'
        WHEN lower(COALESCE(s."name", '')) LIKE '%history%' OR COALESCE(s."name", '') LIKE '%历史%' THEN 'history'
        WHEN lower(COALESCE(s."name", '')) LIKE '%geography%' OR COALESCE(s."name", '') LIKE '%地理%' THEN 'geography'
        WHEN lower(COALESCE(s."name", '')) LIKE '%politics%' OR COALESCE(s."name", '') LIKE '%政治%' THEN 'politics'
        ELSE 'other'
    END AS "subject",
    trim(CAST(j."value" AS TEXT)) AS "name"
FROM "ErrorItem" e
LEFT JOIN "Subject" s ON s."id" = e."subjectId"
JOIN json_each(
    CASE
        WHEN json_valid(e."knowledgePoints") AND json_type(e."knowledgePoints") = 'array' THEN e."knowledgePoints"
        WHEN json_valid(e."knowledgePoints") THEN json_array(json_extract(e."knowledgePoints", '$'))
        ELSE json_array(e."knowledgePoints")
    END
) j
WHERE e."knowledgePoints" IS NOT NULL
  AND trim(e."knowledgePoints") NOT IN ('', '[]', 'null')
  AND trim(CAST(j."value" AS TEXT)) <> '';

INSERT INTO "KnowledgeTag" (
    "id", "name", "subject", "parentId", "order", "code", "isSystem", "userId", "createdAt", "updatedAt"
)
SELECT lower(hex(randomblob(16))), l."name", l."subject", NULL, 0, NULL, false, l."userId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "_LegacyKnowledgePoint" l
WHERE NOT EXISTS (
    SELECT 1 FROM "KnowledgeTag" t
    WHERE t."name" = l."name"
      AND t."subject" = l."subject"
      AND t."userId" = l."userId"
      AND t."parentId" IS NULL
)
GROUP BY l."name", l."subject", l."userId";

INSERT OR IGNORE INTO "_ErrorItemToKnowledgeTag" ("A", "B")
SELECT l."errorItemId", t."id"
FROM "_LegacyKnowledgePoint" l
JOIN "KnowledgeTag" t
  ON t."name" = l."name"
 AND t."subject" = l."subject"
 AND t."userId" = l."userId"
 AND t."parentId" IS NULL;

DROP TABLE "_LegacyKnowledgePoint";
DROP TABLE "ReviewSchedule";

-- Remove the legacy column and enforce masteryLevel at the database boundary.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ErrorItem" (
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
    "masteryLevel" INTEGER NOT NULL DEFAULT 0 CHECK ("masteryLevel" IN (0, 1, 2)),
    "gradeSemester" TEXT,
    "paperLevel" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ErrorItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ErrorItem_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ErrorItem" (
    "id", "userId", "subjectId", "originalImageUrl", "ocrText", "questionText", "answerText", "analysis",
    "wrongAnswerText", "mistakeAnalysis", "mistakeStatus", "geogebraCommands", "source", "errorType", "userNotes",
    "masteryLevel", "gradeSemester", "paperLevel", "createdAt", "updatedAt"
)
SELECT
    "id", "userId", "subjectId", "originalImageUrl", "ocrText", "questionText", "answerText", "analysis",
    "wrongAnswerText", "mistakeAnalysis", "mistakeStatus", "geogebraCommands", "source", "errorType", "userNotes",
    CASE WHEN "masteryLevel" IN (0, 1, 2) THEN "masteryLevel" ELSE 0 END,
    "gradeSemester", "paperLevel", "createdAt", "updatedAt"
FROM "ErrorItem";
DROP TABLE "ErrorItem";
ALTER TABLE "new_ErrorItem" RENAME TO "ErrorItem";
CREATE INDEX "ErrorItem_userId_subjectId_createdAt_idx" ON "ErrorItem"("userId", "subjectId", "createdAt");
CREATE INDEX "ErrorItem_userId_masteryLevel_idx" ON "ErrorItem"("userId", "masteryLevel");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

CREATE INDEX "PracticeRecord_userId_createdAt_idx" ON "PracticeRecord"("userId", "createdAt");

-- Prisma's nullable compound unique index permits duplicate NULL values in SQLite.
DROP INDEX "KnowledgeTag_subject_name_userId_parentId_key";
CREATE TEMP TABLE "_KnowledgeTagDuplicate" AS
SELECT t."id" AS "oldId", (
    SELECT MIN(c."id")
    FROM "KnowledgeTag" c
    WHERE c."subject" = t."subject"
      AND c."name" = t."name"
      AND COALESCE(c."userId", '') = COALESCE(t."userId", '')
      AND COALESCE(c."parentId", '') = COALESCE(t."parentId", '')
) AS "newId"
FROM "KnowledgeTag" t;

INSERT OR IGNORE INTO "_ErrorItemToKnowledgeTag" ("A", "B")
SELECT r."A", d."newId"
FROM "_ErrorItemToKnowledgeTag" r
JOIN "_KnowledgeTagDuplicate" d ON d."oldId" = r."B"
WHERE d."oldId" <> d."newId";
DELETE FROM "_ErrorItemToKnowledgeTag"
WHERE "B" IN (SELECT "oldId" FROM "_KnowledgeTagDuplicate" WHERE "oldId" <> "newId");
UPDATE "KnowledgeTag"
SET "parentId" = (SELECT d."newId" FROM "_KnowledgeTagDuplicate" d WHERE d."oldId" = "KnowledgeTag"."parentId")
WHERE "parentId" IN (SELECT "oldId" FROM "_KnowledgeTagDuplicate" WHERE "oldId" <> "newId");
DELETE FROM "KnowledgeTag"
WHERE "id" IN (SELECT "oldId" FROM "_KnowledgeTagDuplicate" WHERE "oldId" <> "newId");
DROP TABLE "_KnowledgeTagDuplicate";

CREATE UNIQUE INDEX "KnowledgeTag_subject_name_owner_parent_key"
ON "KnowledgeTag"("subject", "name", COALESCE("userId", ''), COALESCE("parentId", ''));
