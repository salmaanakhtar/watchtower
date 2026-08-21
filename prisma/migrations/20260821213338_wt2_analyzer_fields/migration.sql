-- AlterTable
ALTER TABLE "Submission" ADD COLUMN "contentHash" TEXT;
ALTER TABLE "Submission" ADD COLUMN "filename" TEXT;
ALTER TABLE "Submission" ADD COLUMN "result" TEXT;
ALTER TABLE "Submission" ADD COLUMN "sizeBytes" INTEGER;

-- CreateIndex
CREATE INDEX "Submission_contentHash_createdAt_idx" ON "Submission"("contentHash", "createdAt");
