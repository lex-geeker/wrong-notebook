DROP INDEX "ErrorItem_userId_correctedAt_idx";
ALTER TABLE "ErrorItem" DROP COLUMN "correctedAt";
ALTER TABLE "PracticeSessionItem" DROP COLUMN "purpose";
