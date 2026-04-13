import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { app } from "../src/app";
import { buildPortfolioPerformance } from "../src/lib/performance";
import { prisma } from "../src/lib/prisma";

describe.sequential("portfolio performance", () => {
  beforeEach(async () => {
    await prisma.transaction.deleteMany();
    await prisma.importedBrokerRow.deleteMany();
    await prisma.importedPosition.deleteMany();
    await prisma.asset.deleteMany();
  });

  it("builds daily USD performance points aligned with the benchmark", async () => {
    const result = await buildPortfolioPerformance({
      assets: [
        {
          id: "asset-sap",
          symbol: "SAP",
          name: "SAP",
          currency: "EUR",
          assetClass: "STOCK" as never,
          portfolioEligible: true,
          currentPrice: 0 as never,
          createdAt: new Date("2025-01-01T00:00:00.000Z"),
          updatedAt: new Date("2025-01-01T00:00:00.000Z"),
          transactions: [
            {
              id: "tx-1",
              assetId: "asset-sap",
              type: "BUY",
              quantity: 2 as never,
              price: 100 as never,
              fee: 0 as never,
              occurredAt: new Date("2025-01-02T10:00:00.000Z"),
              note: null,
              importLeg: null,
              importedPositionId: null,
              importedBrokerRowId: null,
              createdAt: new Date("2025-01-02T10:00:00.000Z"),
              updatedAt: new Date("2025-01-02T10:00:00.000Z"),
            },
          ],
        },
      ],
      provider: {
        async getDailySeries(symbol) {
          if (symbol === "SAP") {
            return [
              { date: "2025-01-02", close: 100 },
              { date: "2025-01-03", close: 110 },
            ];
          }

          if (symbol === "SPY") {
            return [
              { date: "2025-01-02", close: 500 },
              { date: "2025-01-03", close: 550 },
            ];
          }

          return [];
        },
        async getFxDailySeries() {
          return [
            { date: "2025-01-02", close: 1.1 },
            { date: "2025-01-03", close: 1.2 },
          ];
        },
      },
      benchmarkSymbol: "SPY",
      benchmarkLabel: "S&P 500",
    });

    expect(result.currency).toBe("USD");
    expect(result.benchmarkLabel).toBe("S&P 500");
    expect(result.points.slice(0, 2)).toEqual([
      {
        date: "2025-01-02",
        portfolioValue: 220,
        costBasis: 220,
        unrealizedPnL: 0,
        benchmarkValue: 220,
        portfolioReturnPct: 0,
        benchmarkReturnPct: 0,
      },
      {
        date: "2025-01-03",
        portfolioValue: 264,
        costBasis: 240,
        unrealizedPnL: 24,
        benchmarkValue: 242,
        portfolioReturnPct: 20,
        benchmarkReturnPct: 10,
      },
    ]);
    expect(result.coverage).toEqual({
      hasPortfolioData: true,
      hasBenchmarkData: true,
      missingSymbols: [],
      missingCurrencies: [],
      marketValuePointCount: result.points.length,
      costBasisPointCount: result.points.length,
    });
  });

  it("returns an empty endpoint state when no holdings exist", async () => {
    const response = await request(app).get("/api/portfolio/performance");

    expect(response.status).toBe(200);
    expect(response.body.data.points).toEqual([]);
    expect(response.body.data.coverage.hasPortfolioData).toBe(false);
    expect(response.body.data.coverage.marketValuePointCount).toBe(0);
    expect(response.body.data.coverage.costBasisPointCount).toBe(0);
  });

  it("keeps EUR cost basis history available even when live providers are unavailable", async () => {
    const result = await buildPortfolioPerformance({
      assets: [
        {
          id: "asset-sap",
          symbol: "SAP",
          name: "SAP",
          currency: "EUR",
          assetClass: "STOCK" as never,
          portfolioEligible: true,
          currentPrice: 0 as never,
          createdAt: new Date("2025-01-01T00:00:00.000Z"),
          updatedAt: new Date("2025-01-01T00:00:00.000Z"),
          transactions: [
            {
              id: "tx-1",
              assetId: "asset-sap",
              type: "BUY",
              quantity: 2 as never,
              price: 100 as never,
              fee: 0 as never,
              occurredAt: new Date("2025-01-02T10:00:00.000Z"),
              note: null,
              importLeg: null,
              importedPositionId: null,
              importedBrokerRowId: null,
              createdAt: new Date("2025-01-02T10:00:00.000Z"),
              updatedAt: new Date("2025-01-02T10:00:00.000Z"),
            },
          ],
        },
      ],
      provider: null,
      benchmarkSymbol: "SPY",
      benchmarkLabel: "S&P 500",
    });

    expect(result.points[0]).toEqual({
      date: "2025-01-02",
      portfolioValue: null,
      costBasis: 218,
      unrealizedPnL: null,
      benchmarkValue: null,
      portfolioReturnPct: null,
      benchmarkReturnPct: null,
    });
    expect(result.coverage.missingCurrencies).toEqual([]);
    expect(result.coverage.costBasisPointCount).toBe(result.points.length);
  });
});
