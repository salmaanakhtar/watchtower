-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "verification" TEXT NOT NULL DEFAULT 'verified',
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LedgerEntry_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "LedgerEntry_userId_recordedAt_idx" ON "LedgerEntry"("userId", "recordedAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_obligationId_idx" ON "LedgerEntry"("obligationId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_userId_obligationId_category_key" ON "LedgerEntry"("userId", "obligationId", "category");
