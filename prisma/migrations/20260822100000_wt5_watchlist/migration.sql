-- AlterTable
ALTER TABLE "WatchItem" ADD COLUMN "userNote" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "WatchItem_userId_obligationId_key" ON "WatchItem"("userId", "obligationId");
