-- CreateTable
CREATE TABLE "PracticeSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "questionSource" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'zh',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "PracticeSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PracticeSessionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "errorItemId" TEXT,
    "position" INTEGER NOT NULL,
    "subjectName" TEXT,
    "gradeSemester" TEXT,
    "knowledgePoints" TEXT,
    "sourceQuestionText" TEXT NOT NULL,
    "sourceAnswerText" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "answerText" TEXT NOT NULL,
    "generationMode" TEXT NOT NULL DEFAULT 'original',
    CONSTRAINT "PracticeSessionItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PracticeSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PracticeSessionItem_errorItemId_fkey" FOREIGN KEY ("errorItemId") REFERENCES "ErrorItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTable
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PracticeRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sessionItemId" TEXT,
    "errorItemId" TEXT,
    "subject" TEXT,
    "difficulty" TEXT,
    "isCorrect" BOOLEAN,
    "answerInput" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PracticeRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PracticeRecord_sessionItemId_fkey" FOREIGN KEY ("sessionItemId") REFERENCES "PracticeSessionItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PracticeRecord_errorItemId_fkey" FOREIGN KEY ("errorItemId") REFERENCES "ErrorItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PracticeRecord" ("createdAt", "difficulty", "id", "isCorrect", "subject", "userId") SELECT "createdAt", "difficulty", "id", "isCorrect", "subject", "userId" FROM "PracticeRecord";
DROP TABLE "PracticeRecord";
ALTER TABLE "new_PracticeRecord" RENAME TO "PracticeRecord";
CREATE UNIQUE INDEX "PracticeRecord_sessionItemId_key" ON "PracticeRecord"("sessionItemId");
CREATE INDEX "PracticeRecord_errorItemId_idx" ON "PracticeRecord"("errorItemId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PracticeSession_userId_startedAt_idx" ON "PracticeSession"("userId", "startedAt");
CREATE UNIQUE INDEX "PracticeSessionItem_sessionId_position_key" ON "PracticeSessionItem"("sessionId", "position");
CREATE UNIQUE INDEX "PracticeSessionItem_sessionId_errorItemId_key" ON "PracticeSessionItem"("sessionId", "errorItemId");
CREATE INDEX "PracticeSessionItem_errorItemId_idx" ON "PracticeSessionItem"("errorItemId");
