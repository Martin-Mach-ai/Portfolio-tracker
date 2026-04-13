import { AssetClass, ImportedPositionState, TransactionType } from "@prisma/client";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { AppError } from "../src/lib/errors";
import { buildXtbPreview, parseXtbWorkbook } from "../src/lib/xtb";

type WorkbookSheet = {
  name: string;
  rows: unknown[][];
};

function createWorkbookBuffer(sheets: WorkbookSheet[]): Buffer {
  const workbook = XLSX.utils.book_new();

  for (const sheetData of sheets) {
    const sheet = XLSX.utils.aoa_to_sheet(sheetData.rows);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetData.name);
  }

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function buildCurrentXtbWorkbook(): Buffer {
  return createWorkbookBuffer([
    {
      name: "Closed Positions",
      rows: [
        ["XTB Export history"],
        ["Account", "1234567"],
        ["Generated", "2026-03-10 12:34:56"],
        ["Product", "My Trades"],
        [
          "Instrument",
          "Category",
          "Ticker",
          "Type",
          "Volume",
          "Open price",
          "Open Time (UTC)",
          "Close price",
          "Close Time (UTC)",
          "Product",
          "Profit/Loss",
          "Gross Profit",
        ],
        [
          "Aehr Test",
          "STOCK",
          "AEHR.US",
          "BUY",
          3,
          20.49,
          "2024-07-18 14:04:09.350",
          28.11,
          "2025-09-15 18:37:11.344",
          "My Trades",
          299.96,
          299.96,
        ],
        [
          "ETHEREUM",
          "CFD",
          "ETHEREUM",
          "BUY",
          0.12,
          3731.36,
          "2024-12-11 12:24:27.345",
          3916.21,
          "2024-12-12 09:07:02.763",
          "My Trades",
          518.18,
          528.91,
        ],
      ],
    },
    {
      name: "Cash Operations",
      rows: [
        ["XTB Export history"],
        ["Account", "1234567"],
        ["Generated", "2026-03-10 12:34:56"],
        ["Product", "My Trades"],
        ["Type", "Instrument", "Time", "Amount", "ID", "Comment", "Product"],
        [
          "Dividend",
          "BAT",
          "2026-02-13 10:59:46.058",
          148.98,
          1137227341,
          "BTI.US USD 0.8134/ SHR",
          "My Trades",
        ],
      ],
    },
  ]);
}

describe("XTB parser", () => {
  it("parses the current multi-sheet XTB export from the closed-position sheet", () => {
    const parsed = parseXtbWorkbook(buildCurrentXtbWorkbook(), {
      fileName: "CZK_xtb-current-report.xlsx",
    });

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      broker: "XTB",
      sourceRow: 6,
      symbol: "AEHR.US",
      currency: "USD",
      assetClass: AssetClass.STOCK,
      portfolioEligible: true,
      positionState: ImportedPositionState.CLOSED,
      direction: TransactionType.BUY,
      volume: 3,
      openPrice: 20.49,
      closePrice: 28.11,
      profit: 299.96,
    });
    expect(parsed[0]?.externalId).toMatch(/^generated:/);
    expect(parsed[0]?.openTime.toISOString()).toBe("2024-07-18T14:04:09.350Z");
    expect(parsed[0]?.closeTime?.toISOString()).toBe("2025-09-15T18:37:11.344Z");
    expect(parsed[1]).toMatchObject({
      symbol: "ETHEREUM",
      assetClass: AssetClass.CFD,
      currency: "CZK",
      profit: 518.18,
      portfolioEligible: false,
    });
  });

  it("still detects the legacy instrument header after metadata rows", () => {
    const buffer = createWorkbookBuffer([
      {
        name: "Report",
        rows: [
          ["XTB Account Statement"],
          ["Generated", "2025-03-01"],
          [],
          [
            "Position ID",
            "Instrument",
            "Type",
            "Open Time",
            "Close Time",
            "Volume",
            "Open Price",
            "Close Price",
            "Profit",
            "Currency",
          ],
          [12345, "EURUSD", "BUY", "2025-01-10T09:00:00.000Z", "2025-01-10T10:30:00.000Z", 1.5, 1.1, 1.2, 15, "USD"],
        ],
      },
    ]);

    const parsed = parseXtbWorkbook(buffer);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      broker: "XTB",
      externalId: "12345",
      symbol: "EURUSD",
      currency: "USD",
      assetClass: AssetClass.FOREX,
      portfolioEligible: false,
      direction: TransactionType.BUY,
      volume: 1.5,
      openPrice: 1.1,
      closePrice: 1.2,
      profit: 15,
    });
  });

  it("builds duplicate and excluded preview statuses", () => {
    const preview = buildXtbPreview({
      parsedPositions: [
        {
          sourceRow: 5,
          broker: "XTB",
          source: "POSITION_TABLE",
          externalId: "12345",
          symbol: "BTCUSD",
          currency: "USD",
          assetClass: AssetClass.CFD,
          portfolioEligible: false,
          exclusionReason: "XTB CFD instruments are imported only for audit and excluded from portfolio metrics",
          category: "CFD",
          positionState: ImportedPositionState.CLOSED,
          direction: TransactionType.BUY,
          openTime: new Date("2025-01-10T09:00:00.000Z"),
          closeTime: new Date("2025-01-10T10:00:00.000Z"),
          volume: 1,
          openPrice: 42000,
          closePrice: 43000,
          profit: 1000,
        },
        {
          sourceRow: 6,
          broker: "XTB",
          source: "POSITION_TABLE",
          externalId: "12345",
          symbol: "ETHUSD",
          currency: "USD",
          assetClass: AssetClass.CFD,
          portfolioEligible: false,
          exclusionReason: "Short or sell-first XTB positions are imported only for audit and excluded from portfolio metrics",
          category: "CFD",
          positionState: ImportedPositionState.CLOSED,
          direction: TransactionType.SELL,
          openTime: new Date("2025-01-11T09:00:00.000Z"),
          closeTime: new Date("2025-01-11T10:00:00.000Z"),
          volume: 2,
          openPrice: 2200,
          closePrice: 2100,
          profit: 200,
        },
      ],
      existingFingerprints: new Set(),
      existingAssets: new Map(),
    });

    expect(preview.summary.duplicateCount).toBe(0);
    expect(preview.summary.invalidCount).toBe(1);
    expect(preview.summary.excludedPositionCount).toBe(2);
    expect(preview.summary.transactionCount).toBe(0);
    expect(preview.positions[0].issues.map((issue) => issue.code)).toContain("EXCLUDED_FROM_PORTFOLIO");
    expect(preview.positions[1].issues.map((issue) => issue.code)).toContain("UNSUPPORTED_DIRECTION");
  });

  it("uses a comment currency when the row has no currency column", () => {
    const buffer = createWorkbookBuffer([
      {
        name: "Closed Positions",
        rows: [
          ["XTB Account Statement"],
          ["Generated", "2025-03-01"],
          [],
          [
            "Ticker",
            "Type",
            "Open Time",
            "Close Time",
            "Volume",
            "Open Price",
            "Close Price",
            "Profit/Loss",
            "Comment",
          ],
          [
            "BAT",
            "BUY",
            "2025-01-10T09:00:00.000Z",
            "2025-01-10T10:30:00.000Z",
            10,
            33.1,
            34.5,
            14,
            "BTI.US USD 0.8134/ SHR",
          ],
        ],
      },
    ]);

    const parsed = parseXtbWorkbook(buffer);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.currency).toBe("USD");
  });

  it("parses open-position sheets into BUY-only open positions", () => {
    const buffer = createWorkbookBuffer([
      {
        name: "Open Positions",
        rows: [
          ["XTB Account Statement"],
          ["Generated", "2025-03-01"],
          [],
          ["Position ID", "Ticker", "Category", "Type", "Open Time", "Volume", "Open Price"],
          [99001, "AAPL.US", "STOCK", "BUY", "2025-01-10T09:00:00.000Z", 4, 190],
        ],
      },
    ]);

    const parsed = parseXtbWorkbook(buffer);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      externalId: "99001",
      source: "POSITION_TABLE",
      symbol: "AAPL.US",
      assetClass: AssetClass.STOCK,
      portfolioEligible: true,
      positionState: ImportedPositionState.OPEN,
      closeTime: null,
      closePrice: null,
      profit: null,
    });
  });

  it("prefers stock trades from cash operations and keeps sell-first rows invalid in preview", () => {
    const buffer = createWorkbookBuffer([
      {
        name: "Cash Operations",
        rows: [
          ["XTB Export history"],
          ["Account", "1234567"],
          ["Generated", "2026-03-23 12:34:56"],
          ["Product", "My Trades"],
          ["Type", "Instrument", "Time", "Amount", "ID", "Comment", "Product"],
          ["Dividend", "Aehr Test", "2025-01-05T09:00:00.000Z", 1, 1001, "AEHR.US USD 0.10/ SHR", "My Trades"],
          ["Dividend", "Shell", "2025-01-05T09:00:00.000Z", 1, 1002, "SHELL.NL EUR 0.10/ SHR", "My Trades"],
          ["Stock purchase", "Aehr Test", "2025-01-10T09:00:00.000Z", -380, 1003, "OPEN BUY 2 @ 190.00", "My Trades"],
          ["Stock sell", "Aehr Test", "2025-01-15T11:30:00.000Z", 205, 1004, "CLOSE BUY 1/2 @ 205.00", "My Trades"],
          ["Stock sell", "Shell", "2025-01-16T11:30:00.000Z", 31, 1005, "CLOSE BUY 1 @ 31.00", "My Trades"],
        ],
      },
    ]);

    const parsed = parseXtbWorkbook(buffer, {
      fileName: "CZK_xtb-cash-operations.xlsx",
    });

    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toMatchObject({
      source: "CASH_OPERATION",
      symbol: "AEHR.US",
      direction: TransactionType.BUY,
      volume: 2,
      openPrice: 190,
    });
    expect(parsed[1]).toMatchObject({
      source: "CASH_OPERATION",
      symbol: "AEHR.US",
      direction: TransactionType.SELL,
      volume: 1,
      openPrice: 205,
    });

    const preview = buildXtbPreview({
      parsedPositions: parsed,
      existingFingerprints: new Set(),
      existingAssets: new Map(),
      existingTransactionsBySymbol: new Map(),
    });

    expect(preview.summary.readyPositionCount).toBe(2);
    expect(preview.summary.invalidCount).toBe(1);
    expect(preview.summary.transactionCount).toBe(3);
    expect(preview.positions[2]?.symbol).toBe("SHELL.NL");
    expect(preview.positions[2]?.status).toBe("invalid");
    expect(preview.positions[2]?.issues.map((issue) => issue.code)).toContain("UNSUPPORTED_DIRECTION");
  });

  it("throws a clear error when a required column is missing", () => {
    const buffer = createWorkbookBuffer([
      {
        name: "CLOSED POSITION HISTORY",
        rows: [
          ["XTB Account Statement"],
          ["Position", "Symbol", "Type", "Volume", "Open time", "Open price", "Close time"],
          [1, "BTCUSD", "BUY", 1, "2025-01-10 09:00:00.000", 42000, "2025-01-10 10:00:00.000"],
        ],
      },
    ]);

    expect(() => parseXtbWorkbook(buffer)).toThrow(AppError);
    expect(() => parseXtbWorkbook(buffer)).toThrow(/close price column/i);
  });
});
