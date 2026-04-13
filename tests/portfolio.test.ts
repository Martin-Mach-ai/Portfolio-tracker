import { describe, expect, it } from "vitest";

import { calculateHoldingMetrics } from "../src/lib/portfolio";

describe("portfolio metrics", () => {
  it("keeps market metrics unavailable when the current price is missing", () => {
    const metrics = calculateHoldingMetrics(
      [
        {
          id: "tx-1",
          assetId: "asset-1",
          type: "BUY",
          quantity: 2,
          price: 100,
          fee: 0,
          occurredAt: new Date("2025-01-10T09:00:00.000Z"),
          createdAt: new Date("2025-01-10T09:00:00.000Z"),
        },
      ],
      null,
    );

    expect(metrics.quantity).toBe(2);
    expect(metrics.averageCost).toBe(100);
    expect(metrics.costBasis).toBe(200);
    expect(metrics.currentPrice).toBeNull();
    expect(metrics.marketValue).toBeNull();
    expect(metrics.unrealizedPnL).toBeNull();
    expect(metrics.hasMarketPrice).toBe(false);
  });

  it("calculates market metrics when the current price is available", () => {
    const metrics = calculateHoldingMetrics(
      [
        {
          id: "tx-1",
          assetId: "asset-1",
          type: "BUY",
          quantity: 2,
          price: 100,
          fee: 0,
          occurredAt: new Date("2025-01-10T09:00:00.000Z"),
          createdAt: new Date("2025-01-10T09:00:00.000Z"),
        },
      ],
      125,
    );

    expect(metrics.currentPrice).toBe(125);
    expect(metrics.marketValue).toBe(250);
    expect(metrics.unrealizedPnL).toBe(50);
    expect(metrics.hasMarketPrice).toBe(true);
  });
});
