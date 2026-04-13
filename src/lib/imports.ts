import { Broker, TransactionType } from "@prisma/client";
import * as XLSX from "xlsx";

import { AppError } from "./errors";

export type ImportPreviewStatus = "ready" | "duplicate" | "invalid";

export type ImportIssueCode =
  | "DUPLICATE_IN_DB"
  | "DUPLICATE_IN_FILE"
  | "CURRENCY_MISMATCH"
  | "UNSUPPORTED_DIRECTION"
  | "EXCLUDED_FROM_PORTFOLIO"
  | "UNSUPPORTED_ROW_TYPE"
  | "MISSING_REQUIRED_FIELD"
  | "INVALID_NUMBER"
  | "INVALID_DATE";

export type ImportPreviewIssue = {
  code: ImportIssueCode;
  message: string;
};

type ImportPreviewItemBase = {
  sourceRow: number;
  broker: Broker;
  externalId?: string | null;
  symbol: string;
  currency: string;
  status: ImportPreviewStatus;
  issues: ImportPreviewIssue[];
};

export type XtbImportPreviewItem = ImportPreviewItemBase & {
  broker: "XTB";
  externalId: string;
  assetClass: "STOCK" | "ETF" | "CFD" | "CRYPTO" | "FOREX" | "UNKNOWN";
  portfolioEligible: boolean;
  exclusionReason?: string | null;
  category?: string | null;
  positionState: "OPEN" | "CLOSED";
  direction: TransactionType;
  openTime: Date;
  closeTime: Date | null;
  volume: number;
  openPrice: number;
  closePrice: number | null;
  profit: number | null;
};

export type Trading212ImportPreviewItem = ImportPreviewItemBase & {
  broker: "TRADING212";
  externalId?: string | null;
  occurredAt: Date | null;
  type: TransactionType | null;
  quantity: number | null;
  price: number | null;
  fee: number | null;
  fingerprint: string;
  rowType: string;
};

export type ImportPreviewItem = XtbImportPreviewItem | Trading212ImportPreviewItem;

export type ImportPreviewTransaction = {
  symbol: string;
  date: string;
  type: TransactionType;
  quantity: number;
  price: number;
  fee: number;
  currency: string;
  broker: Broker;
  externalId?: string | null;
  leg?: "OPEN" | "CLOSE";
  portfolioEligible?: boolean;
  exclusionReason?: string | null;
  status: ImportPreviewStatus;
};

export type SpreadsheetSheet = {
  name: string;
  rows: unknown[][];
};

export type SpreadsheetWorkbook = {
  sheets: SpreadsheetSheet[];
};

export function normalizeCell(value: unknown): string {
  return String(value ?? "").trim();
}

export function canonicalizeHeader(value: unknown): string {
  return normalizeCell(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function isBlankCell(value: unknown): boolean {
  return value === null || value === undefined || normalizeCell(value) === "";
}

export function readSpreadsheetWorkbook(buffer: Buffer): SpreadsheetWorkbook {
  try {
    const workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: true,
      raw: true,
    });

    if (workbook.SheetNames.length === 0) {
      throw new AppError(400, "IMPORT_PARSE_ERROR", "The uploaded report does not contain any sheets");
    }

    return {
      sheets: workbook.SheetNames.map((name) => {
        const sheet = workbook.Sheets[name];

        if (!sheet) {
          return {
            name,
            rows: [],
          };
        }

        return {
          name,
          rows: XLSX.utils.sheet_to_json<unknown[]>(sheet, {
            header: 1,
            raw: true,
            defval: null,
            blankrows: false,
          }),
        };
      }),
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(400, "IMPORT_PARSE_ERROR", "Unable to read the uploaded report");
  }
}

export function readSpreadsheetRows(buffer: Buffer): unknown[][] {
  const workbook = readSpreadsheetWorkbook(buffer);
  const firstSheet = workbook.sheets[0];

  if (!firstSheet) {
    throw new AppError(400, "IMPORT_PARSE_ERROR", "The uploaded report does not contain any sheets");
  }

  return firstSheet.rows;
}

export function buildImportSummary(items: ImportPreviewItem[], transactions: ImportPreviewTransaction[]) {
  return {
    itemCount: items.length,
    readyCount: items.filter((item) => item.status === "ready").length,
    duplicateCount: items.filter((item) => item.status === "duplicate").length,
    invalidCount: items.filter((item) => item.status === "invalid").length,
    transactionCount: transactions.length,
  };
}

export function assertSupportedImportExtension(fileName: string): void {
  const normalizedName = fileName.toLowerCase();

  if (!normalizedName.endsWith(".xlsx") && !normalizedName.endsWith(".csv")) {
    throw new AppError(400, "INVALID_IMPORT_FILE", "Only .csv and .xlsx reports are supported");
  }
}
