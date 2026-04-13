-- CreateTable
CREATE TABLE "ImportedPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "broker" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "openTime" DATETIME NOT NULL,
    "closeTime" DATETIME NOT NULL,
    "volume" DECIMAL NOT NULL,
    "openPrice" DECIMAL NOT NULL,
    "closePrice" DECIMAL NOT NULL,
    "profit" DECIMAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Transaction_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_importedPositionId_fkey" FOREIGN KEY ("importedPositionId") REFERENCES "ImportedPosition" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("assetId", "createdAt", "fee", "id", "note", "occurredAt", "price", "quantity", "type", "updatedAt") SELECT "assetId", "createdAt", "fee", "id", "note", "occurredAt", "price", "quantity", "type", "updatedAt" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE INDEX "Transaction_assetId_occurredAt_createdAt_idx" ON "Transaction"("assetId", "occurredAt", "createdAt");
CREATE UNIQUE INDEX "Transaction_importedPositionId_importLeg_key" ON "Transaction"("importedPositionId", "importLeg");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ImportedPosition_broker_externalId_key" ON "ImportedPosition"("broker", "externalId");
