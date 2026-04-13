import { createHash } from "node:crypto";

import { Broker, TransactionType, type Asset } from "@prisma/client";

import { AppError } from "./errors";
import {
  buildImportSummary,
  canonicalizeHeader,
  isBlankCell,
  normalizeCell,
  type ImportPreviewIssue,
  type ImportPreviewTransaction,
  type Trading212ImportPreviewItem,
} from "./imports";

const REQUIRED_HEADERS: Record<string, readonly string[]> = {
  action: ["action", "type"],
  occurredAt: ["time", "date", "datetime"],
  symbol: ["ticker", "symbol", "instrument"],
  quantity: ["noofshares", "quantity", "shares", "numberofshares"],
  price: ["pricepershare", "priceshare", "price", "pershareprice"],
  currency: ["currency", "currencypricepershare", "currencypriceshare"],
};

const OPTIONAL_HEADERS: Record<string, readonly string[]> = {
  fee: ["fee", "commission"],
  externalId: ["id", "orderid", "transactionid", "referenceno", "reference"],
};

const IGNORED_ACTION_KEYWORDS = [
  "deposit",
  "withdraw",
  "dividend",
  "interest",
  "tax",
  "currency conversion",
  "fee",
  "loan interest",
  "lending interest",
] as const;

function findColumnIndex(headers: string[], aliases: readonly string[]): number {
  return headers.findIndex((header) => aliases.includes(header));
}

export function findTrading212HeaderRow(rows: unknown[][]): number {
  return rows.findIndex((row) => {
    const headers = row.map((value) => canonicalizeHeader(value));
    return (
      findColumnIndex(headers, REQUIRED_HEADERS.action) !== -1 &&
      findColumnIndex(headers, REQUIRED_HEADERS.symbol) !== -1
    );
  });
}

export function canParseTrading212Rows(rows: unknown[][]): boolean {
  const headerRowIndex = findTrading212HeaderRow(rows);

  if (headerRowIndex === -1) {
    return false;
  }

  const headers = rows[headerRowIndex].map((value) => canonicalizeHeader(value));

  return Object.values(REQUIRED_HEADERS).every((aliases) => findColumnIndex(headers, aliases) !== -1);
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || normalizeCell(value) === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const input = normalizeCell(value);
  const normalized =
    input.includes(",") && input.includes(".")
      ? input.replace(/,/g, "")
      : input.includes(",")
        ? input.replace(",", ".")
        : input;
  const numeric = Number(normalized.replace(/\s+/g, ""));

  return Number.isFinite(numeric) ? numeric : null;
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const input = normalizeCell(value);

  if (!input) {
    return null;
  }

  const date = new Date(input);

  return Number.isNaN(date.getTime()) ? null : date;
}

function parseTradeType(value: string): TransactionType | null {
  const normalized = value.trim().toLowerCase();

  if (normalized.includes("buy")) {
    return TransactionType.BUY;
  }

  if (normalized.includes("sell")) {
    return TransactionType.SELL;
  }

  return null;
}

function shouldIgnoreRowType(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  return IGNORED_ACTION_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function buildFingerprint(options: {
  externalId: string | null;
  symbol: string;
  occurredAt: Date | null;
  type: TransactionType | null;
  quantity: number | null;
  price: number | null;
  fee: number | null;
  currency: string;
  rowType: string;
}): string {
  if (options.externalId) {
    return `${Broker.TRADING212}:${options.externalId}`;
  }

  return createHash("sha256")
    .update(
      JSON.stringify({
        broker: Broker.TRADING212,
        symbol: options.symbol,
        occurredAt: options.occurredAt?.toISOString() ?? null,
        type: options.type,
        quantity: options.quantity,
        price: options.price,
        fee: options.fee,
        currency: options.currency,
        rowType: options.rowType,
      }),
    )
    .digest("hex");
}

export function buildTrading212Preview(options: {
  rows: unknown[][];
  existingFingerprints: Set<string>;
  existingAssets: Map<string, Pick<Asset, "id" | "currency">>;
}): {
  items: Trading212ImportPreviewItem[];
  transactions: ImportPreviewTransaction[];
  summary: {
    itemCount: number;
    readyCount: number;
    duplicateCount: number;
    invalidCount: number;
    transactionCount: number;
  };
} {
  const headerRowIndex = findTrading212HeaderRow(options.rows);

  if (headerRowIndex === -1) {
    throw new AppError(400, "TRADING212_PARSE_ERROR", "Unable to find the Trading212 header row");
  }

  const headers = options.rows[headerRowIndex].map((value) => canonicalizeHeader(value));
  const indexes = {
    action: findColumnIndex(headers, REQUIRED_HEADERS.action),
    occurredAt: findColumnIndex(headers, REQUIRED_HEADERS.occurredAt),
    symbol: findColumnIndex(headers, REQUIRED_HEADERS.symbol),
    quantity: findColumnIndex(headers, REQUIRED_HEADERS.quantity),
    price: findColumnIndex(headers, REQUIRED_HEADERS.price),
    currency: findColumnIndex(headers, REQUIRED_HEADERS.currency),
    fee: findColumnIndex(headers, OPTIONAL_HEADERS.fee),
    externalId: findColumnIndex(headers, OPTIONAL_HEADERS.externalId),
  };

  const missingField = Object.entries(indexes)
    .filter(([field]) => field in REQUIRED_HEADERS)
    .find(([, value]) => value === -1)?.[0];

  if (missingField) {
    throw new AppError(
      400,
      "TRADING212_PARSE_ERROR",
      `The Trading212 report is missing the required ${missingField} column`,
    );
  }

  const seenFingerprints = new Set<string>();
  const items: Trading212ImportPreviewItem[] = [];
  const transactions: ImportPreviewTransaction[] = [];

  for (let index = headerRowIndex + 1; index < options.rows.length; index += 1) {
    const row = options.rows[index];
    const sourceRow = index + 1;

    if (!row || row.every(isBlankCell)) {
      continue;
    }

    const issues: ImportPreviewIssue[] = [];
    const rowType = normalizeCell(row[indexes.action]) || "Unknown";
    const type = parseTradeType(rowType);

    if (!type && shouldIgnoreRowType(rowType)) {
      continue;
    }

    const externalId =
      indexes.externalId === -1 ? null : normalizeCell(row[indexes.externalId]) || null;
    const rawSymbol = normalizeCell(row[indexes.symbol]).toUpperCase();
    const rawCurrency = normalizeCell(row[indexes.currency]).toUpperCase();
    const symbol = rawSymbol || externalId || `ROW-${sourceRow}`;
    const currency = rawCurrency || "UNKNOWN";
    const occurredAt = parseDate(row[indexes.occurredAt]);
    const quantity = parseNumber(row[indexes.quantity]);
    const price = parseNumber(row[indexes.price]);
    const feeValue = indexes.fee === -1 ? 0 : parseNumber(row[indexes.fee]);
    const fee = feeValue ?? 0;

    if (!type) {
      issues.push({
        code: "UNSUPPORTED_ROW_TYPE",
        message: `Trading212 row ${sourceRow} uses unsupported action "${rowType}"`,
      });
    }

    if (!rawSymbol) {
      issues.push({
        code: "MISSING_REQUIRED_FIELD",
        message: `Trading212 row ${sourceRow} is missing the symbol`,
      });
    }

    if (!rawCurrency) {
      issues.push({
        code: "MISSING_REQUIRED_FIELD",
        message: `Trading212 row ${sourceRow} is missing the currency`,
      });
    }

    if (!occurredAt) {
      issues.push({
        code: "INVALID_DATE",
        message: `Trading212 row ${sourceRow} has an invalid trade time`,
      });
    }

    if (quantity === null || quantity <= 0) {
      issues.push({
        code: "INVALID_NUMBER",
        message: `Trading212 row ${sourceRow} has an invalid quantity`,
      });
    }

    if (price === null || price < 0) {
      issues.push({
        code: "INVALID_NUMBER",
        message: `Trading212 row ${sourceRow} has an invalid price`,
      });
    }

    if (indexes.fee !== -1 && feeValue === null) {
      issues.push({
        code: "INVALID_NUMBER",
        message: `Trading212 row ${sourceRow} has an invalid fee`,
      });
    }

    const existingAsset = rawSymbol ? options.existingAssets.get(rawSymbol) : undefined;

    if (existingAsset && rawCurrency && existingAsset.currency !== rawCurrency) {
      issues.push({
        code: "CURRENCY_MISMATCH",
        message: `Existing asset ${rawSymbol} uses ${existingAsset.currency}, but the Trading212 row uses ${rawCurrency}`,
      });
    }

    const fingerprint = buildFingerprint({
      externalId,
      symbol,
      occurredAt,
      type,
      quantity,
      price,
      fee,
      currency,
      rowType,
    });

    if (seenFingerprints.has(fingerprint)) {
      issues.push({
        code: "DUPLICATE_IN_FILE",
        message: `Trading212 row ${sourceRow} appears multiple times in this file`,
      });
    }

    seenFingerprints.add(fingerprint);

    if (options.existingFingerprints.has(fingerprint)) {
      issues.push({
        code: "DUPLICATE_IN_DB",
        message: `Trading212 row ${sourceRow} has already been imported`,
      });
    }

    const status =
      issues.length === 0
        ? "ready"
        : issues.some((issue) => issue.code === "DUPLICATE_IN_DB" || issue.code === "DUPLICATE_IN_FILE")
          ? "duplicate"
          : "invalid";

    const item: Trading212ImportPreviewItem = {
      broker: Broker.TRADING212,
      sourceRow,
      externalId,
      symbol,
      currency,
      occurredAt,
      type,
      quantity,
      price,
      fee,
      fingerprint,
      rowType,
      status,
      issues,
    };

    items.push(item);

    if (type && occurredAt && quantity !== null && price !== null) {
      transactions.push({
        symbol,
        date: occurredAt.toISOString(),
        type,
        quantity,
        price,
        fee,
        currency,
        broker: Broker.TRADING212,
        externalId,
        status,
      });
    }
  }

  if (items.length === 0) {
    throw new AppError(400, "TRADING212_PARSE_ERROR", "No Trading212 data rows were found after the header");
  }

  return {
    items,
    transactions,
    summary: buildImportSummary(items, transactions),
  };
}

export function buildTrading212LedgerTransaction(item: Trading212ImportPreviewItem) {
  if (!item.occurredAt || !item.type || item.quantity === null || item.price === null || item.fee === null) {
    throw new AppError(400, "TRADING212_IMPORT_INVALID", `Trading212 row ${item.sourceRow} is not importable`);
  }

  return {
    occurredAt: item.occurredAt,
    type: item.type,
    quantity: item.quantity,
    price: item.price,
    fee: item.fee,
    note: `Imported from Trading212 row ${item.sourceRow}${item.externalId ? ` (${item.externalId})` : ""}`,
  };
}
