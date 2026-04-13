-- DropIndex
DROP INDEX "Transaction_importedBrokerRowId_idx";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "portfolioEligible" BOOLEAN NOT NULL DEFAULT true,
    "currentPrice" DECIMAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Asset" ("createdAt", "currency", "currentPrice", "id", "name", "symbol", "updatedAt") SELECT "createdAt", "currency", "currentPrice", "id", "name", "symbol", "updatedAt" FROM "Asset";
DROP TABLE "Asset";
ALTER TABLE "new_Asset" RENAME TO "Asset";
CREATE UNIQUE INDEX "Asset_symbol_key" ON "Asset"("symbol");
CREATE TABLE "new_ImportedPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "broker" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "portfolioEligible" BOOLEAN NOT NULL DEFAULT true,
    "exclusionReason" TEXT,
    "category" TEXT,
    "positionState" TEXT NOT NULL DEFAULT 'CLOSED',
    "direction" TEXT NOT NULL,
    "openTime" DATETIME NOT NULL,
    "closeTime" DATETIME,
    "volume" DECIMAL NOT NULL,
    "openPrice" DECIMAL NOT NULL,
    "closePrice" DECIMAL,
    "profit" DECIMAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_ImportedPosition" ("broker", "closePrice", "closeTime", "createdAt", "currency", "direction", "externalId", "id", "openPrice", "openTime", "profit", "symbol", "volume") SELECT "broker", "closePrice", "closeTime", "createdAt", "currency", "direction", "externalId", "id", "openPrice", "openTime", "profit", "symbol", "volume" FROM "ImportedPosition";
DROP TABLE "ImportedPosition";
ALTER TABLE "new_ImportedPosition" RENAME TO "ImportedPosition";
CREATE UNIQUE INDEX "ImportedPosition_broker_externalId_key" ON "ImportedPosition"("broker", "externalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
