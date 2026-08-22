-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT,
    "anonymous" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "domain" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'paste',
    "filename" TEXT,
    "contentType" TEXT,
    "extractedText" TEXT NOT NULL,
    "extractionMethod" TEXT NOT NULL DEFAULT 'raw',
    "contentHash" TEXT,
    "storageKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submissionId" TEXT,
    CONSTRAINT "Document_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Obligation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "counterpartyId" TEXT,
    "counterpartyName" TEXT,
    "amountCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "interval" TEXT,
    "amountConfidence" REAL,
    "startDate" DATETIME,
    "renewalDate" DATETIME,
    "noticeDeadlineDate" DATETIME,
    "expiryDate" DATETIME,
    "cancellationNoticeDays" INTEGER,
    "autoRenews" BOOLEAN,
    "termsQuote" TEXT,
    "riskType" TEXT,
    "exposureLowCents" INTEGER,
    "exposureHighCents" INTEGER,
    "exposureAssumption" TEXT,
    "dueDate" DATETIME,
    "verification" TEXT NOT NULL DEFAULT 'hypothetical',
    "confidence" REAL NOT NULL DEFAULT 0.0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "userNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Obligation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Obligation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Obligation_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProvenanceFact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT,
    "obligationId" TEXT,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "offsetStart" INTEGER,
    "offsetEnd" INTEGER,
    "confidence" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProvenanceFact_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProvenanceFact_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WatchItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "obligationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "deadline" DATETIME,
    "nextCheckAt" DATETIME,
    "notifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WatchItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WatchItem_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Deadline" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "obligationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'deadline',
    "dueAt" DATETIME NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Deadline_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "companyId" TEXT,
    "obligationId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "interval" TEXT,
    "date" DATETIME,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Payment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Payment_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "obligationId" TEXT,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Event_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Company_normalized_key" ON "Company"("normalized");

-- CreateIndex
CREATE INDEX "Obligation_userId_status_idx" ON "Obligation"("userId", "status");

-- CreateIndex
CREATE INDEX "Obligation_dueDate_idx" ON "Obligation"("dueDate");

-- CreateIndex
CREATE INDEX "Obligation_renewalDate_idx" ON "Obligation"("renewalDate");

-- CreateIndex
CREATE INDEX "ProvenanceFact_documentId_idx" ON "ProvenanceFact"("documentId");

-- CreateIndex
CREATE INDEX "ProvenanceFact_obligationId_idx" ON "ProvenanceFact"("obligationId");

-- CreateIndex
CREATE INDEX "WatchItem_userId_status_idx" ON "WatchItem"("userId", "status");

-- CreateIndex
CREATE INDEX "WatchItem_obligationId_idx" ON "WatchItem"("obligationId");

-- CreateIndex
CREATE INDEX "Deadline_obligationId_dueAt_idx" ON "Deadline"("obligationId", "dueAt");

-- CreateIndex
CREATE INDEX "Payment_obligationId_idx" ON "Payment"("obligationId");

-- CreateIndex
CREATE INDEX "Event_userId_createdAt_idx" ON "Event"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Event_obligationId_idx" ON "Event"("obligationId");
