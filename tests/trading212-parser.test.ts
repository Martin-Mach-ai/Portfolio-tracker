import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { readSpreadsheetRows } from "../src/lib/imports";
import { buildTrading212Preview, canParseTrading212Rows } from "../src/lib/trading212";

function createWorkbookBuffer(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Report");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("Trading212 parser", () => {
  it("detects transaction-history headers and ignores non-trade cashflow rows", () => {
    const buffer = createWorkbookBuffer([
      ["Trading212 account activity"],
      ["Action", "Time", "Ticker", "No. of shares", "Price / share", "Currency", "Fee", "ID"],
      ["Buy", "2025-01-10T09:00:00.000Z", "AAPL", 2, 190, "USD", 1, "ABC-1"],
      ["Deposit", "2025-01-11T09:00:00.000Z", "", "", "", "USD", "", "ABC-2"],
      ["Dividend (Dividend)", "2025-01-12T09:00:00.000Z", "AAPL", 2, 0.5, "USD", "", ""],
    ]);

    const rows = readSpreadsheetRows(buffer);

    expect(canParseTrading212Rows(rows)).toBe(true);

    const preview = buildTrading212Preview({
      rows,
      existingFingerprints: new Set(),
      existingAssets: new Map(),
    });

    expect(preview.summary.itemCount).toBe(1);
    expect(preview.summary.readyCount).toBe(1);
    expect(preview.summary.invalidCount).toBe(0);
    expect(preview.transactions).toHaveLength(1);
    expect(preview.items[0]?.symbol).toBe("AAPL");
  });
});
