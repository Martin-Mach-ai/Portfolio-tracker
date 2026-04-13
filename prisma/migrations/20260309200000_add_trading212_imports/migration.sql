-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "importedBrokerRowId" TEXT;

-- CreateTable
CREATE TABLE "ImportedBrokerRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "broker" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "externalId" TEXT,
    "symbol" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ImportedBrokerRow_broker_fingerprint_key" ON "ImportedBrokerRow"("broker", "fingerprint");

-- CreateIndex
CREATE INDEX "Transaction_importedBrokerRowId_idx" ON "Transaction"("importedBrokerRowId");

-- AddForeignKey
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "price" DECIMAL NOT NULL,
    "fee" DECIMAL NOT NULL DEFAULT 0,
    "occurredAt" DATETIME NOT NULL,
    "note" TEXT,
    "importLeg" TEXT,
    "importedPositionId" TEXT,
    "importedBrokerRowId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Transaction_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_importedPositionId_fkey" FOREIGN KEY ("importedPositionId") REFERENCES "ImportedPosition" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_importedBrokerRowId_fkey" FOREIGN KEY ("importedBrokerRowId") REFERENCES "ImportedBrokerRow" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("assetId", "createdAt", "fee", "id", "importLeg", "importedPositionId", "note", "occurredAt", "price", "quantity", "type", "updatedAt")
SELECT "assetId", "createdAt", "fee", "id", "importLeg", "importedPositionId", "note", "occurredAt", "price", "quantity", "type", "updatedAt" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE INDEX "Transaction_assetId_occurredAt_createdAt_idx" ON "Transaction"("assetId", "occurredAt", "createdAt");
CREATE UNIQUE INDEX "Transaction_importedPositionId_importLeg_key" ON "Transaction"("importedPositionId", "importLeg");
CREATE INDEX "Transaction_importedBrokerRowId_idx" ON "Transaction"("importedBrokerRowId");
PRAGMA foreign_keys=ON;
