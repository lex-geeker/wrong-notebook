ALTER TABLE "ErrorItem" ADD COLUMN "correctedAt" DATETIME;
UPDATE "ErrorItem" SET "correctedAt" = "createdAt";
CREATE INDEX "ErrorItem_userId_correctedAt_idx" ON "ErrorItem"("userId", "correctedAt");

ALTER TABLE "PracticeSessionItem" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'review';
