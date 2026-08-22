-- DropIndex
DROP INDEX "User_email_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailHash" TEXT;

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "action" TEXT NOT NULL,
    "target" TEXT,
    "detail" TEXT,
    "ip" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Submission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "variant" TEXT NOT NULL DEFAULT 'A',
    "kind" TEXT NOT NULL DEFAULT 'paste',
    "contentType" TEXT,
    "content" TEXT NOT NULL,
    "filename" TEXT,
    "sizeBytes" INTEGER,
    "contentHash" TEXT,
    "rawBytes" TEXT,
    "dataUrl" TEXT,
    "category" TEXT,
    "status" TEXT NOT NULL DEFAULT 'received',
    "analysis" TEXT,
    "result" TEXT,
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "consentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Submission" ("analysis", "category", "content", "contentHash", "contentType", "createdAt", "dataUrl", "filename", "id", "kind", "rawBytes", "result", "sizeBytes", "status", "variant") SELECT "analysis", "category", "content", "contentHash", "contentType", "createdAt", "dataUrl", "filename", "id", "kind", "rawBytes", "result", "sizeBytes", "status", "variant" FROM "Submission";
DROP TABLE "Submission";
ALTER TABLE "new_Submission" RENAME TO "Submission";
CREATE INDEX "Submission_contentHash_createdAt_idx" ON "Submission"("contentHash", "createdAt");
CREATE INDEX "Submission_consent_createdAt_idx" ON "Submission"("consent", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_emailHash_key" ON "User"("emailHash");

