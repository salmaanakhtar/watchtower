-- CreateTable
CREATE TABLE "InboundAddress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "localPart" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "disabledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InboundAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InboundMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "addressId" TEXT,
    "userId" TEXT,
    "resendEmailId" TEXT NOT NULL,
    "messageId" TEXT,
    "fromEmail" TEXT,
    "fromName" TEXT,
    "subject" TEXT,
    "toAddress" TEXT,
    "receivedFor" TEXT,
    "text" TEXT,
    "html" TEXT,
    "headers" TEXT,
    "rawDownloadUrl" TEXT,
    "contentSize" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'received',
    "quarantineReason" TEXT,
    "spamScore" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ingestedAt" DATETIME,
    "documentId" TEXT,
    "failure" TEXT,
    CONSTRAINT "InboundMessage_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "InboundAddress" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InboundMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InboundMessage_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReputationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "email" TEXT,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "InboundAddress_localPart_key" ON "InboundAddress"("localPart");

-- CreateIndex
CREATE UNIQUE INDEX "InboundAddress_token_key" ON "InboundAddress"("token");

-- CreateIndex
CREATE INDEX "InboundAddress_userId_active_idx" ON "InboundAddress"("userId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "InboundMessage_resendEmailId_key" ON "InboundMessage"("resendEmailId");

-- CreateIndex
CREATE INDEX "InboundMessage_addressId_createdAt_idx" ON "InboundMessage"("addressId", "createdAt");

-- CreateIndex
CREATE INDEX "InboundMessage_status_createdAt_idx" ON "InboundMessage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ReputationEvent_kind_createdAt_idx" ON "ReputationEvent"("kind", "createdAt");
