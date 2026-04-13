import { describe, expect, it } from "vitest";

import type { Holding } from "./api";
import { buildDashboardSummary, normalizeDashboardHoldings } from "./dashboard-utils";

function createHolding(overrides: Partial<Holding>): Holding {
  return {
    assetId: "asset",
    symbol: "AAPL",
    name: "Apple",
    currency: "USD",
    assetClass: "STOCK",
    sector: "Technologie",
    region: "Severní Amerika",
    continent: "Severní Amerika",
    baseCurrency: "USD",
    fxRateToBase: 1,
    quantity: 1,
    averageCost: 100,
    costBasis: 100,
    costBasisBase: 100,
    currentPrice: 120,
    marketValue: 120,
    marketValueBase: 120,
    unrealizedPnL: 20,
    unrealizedPnLBase: 20,
    realizedPnLBase: 0,
    hasMarketPrice: true,
    priceSource: "stored",
    priceAsOf: "2025-01-10T00:00:00.000Z",
    marketDataSymbol: null,
    ...overrides,
  };
}

describe("dashboard utils", () => {
  it("keeps partial totals and derives GBX base cost basis for dashboard summary", () => {
    const holdings = normalizeDashboardHoldings([
      createHolding({
        assetId: "priced",
        symbol: "AAPL",
        quantity: 2,
        costBasis: 200,
        costBasisBase: 200,
        currentPrice: 120,
        marketValue: 240,
        marketValueBase: 240,
        unrealizedPnL: 40,
        unrealizedPnLBase: 40,
        realizedPnLBase: 5,
      }),
      createHolding({
        assetId: "gbx",
        symbol: "RR",
        name: "Rolls-Royce",
        currency: "GBX",
        fxRateToBase: null,
        quantity: 100,
        averageCost: 1,
        costBasis: 100,
        costBasisBase: null,
        currentPrice: null,
        marketValue: null,
        marketValueBase: null,
        unrealizedPnL: null,
        unrealizedPnLBase: null,
        realizedPnLBase: null,
        hasMarketPrice: false,
        priceSource: "unavailable",
        priceAsOf: null,
      }),
    ]);

    expect(holdings[1]?.fxRateToBase).toBe(0.0128);
    expect(holdings[1]?.costBasisBase).toBe(1.28);

    const summary = buildDashboardSummary(holdings);

    expect(summary.marketValue).toBe(240);
    expect(summary.costBasis).toBe(201.28);
    expect(summary.unrealizedPnL).toBe(40);
    expect(summary.realizedPnL).toBe(5);
    expect(summary.pricedAssetCount).toBe(1);
    expect(summary.unpricedAssetCount).toBe(1);
    expect(summary.hasCompleteMarketData).toBe(false);
  });
});
