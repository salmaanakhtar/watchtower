-- WT-14: deadline reminder sweep lifecycle.

-- The WT-4 `Deadline` table was never written by any pipeline and had no
-- consumers; it becomes the `NoticeDeadline` model the reminder scheduler
-- actually reads (nearest-deadline selection for multi-deadline obligations).

-- CreateTable
CREATE TABLE "NoticeDeadline" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "obligationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'deadline',
    "dueAt" DATETIME NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NoticeDeadline_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "NoticeDeadline_obligationId_dueAt_idx" ON "NoticeDeadline"("obligationId", "dueAt");

-- DropTable
DROP TABLE "Deadline";

-- AlterTable
ALTER TABLE "WatchItem" ADD COLUMN "lastNotifiedCadence" INTEGER;
