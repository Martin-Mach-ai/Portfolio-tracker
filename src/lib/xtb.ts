import { createHash } from "node:crypto";

import {
  AssetClass,
  Broker,
  ImportedPositionState,
  TransactionType,
  type Asset,
  type Transaction,
} from "@prisma/client";
import * as XLSX from "xlsx";

import { AppError } from "./errors";
import {
  canonicalizeHeader,
  isBlankCell,
  normalizeCell,
  readSpreadsheetWorkbook,
  type SpreadsheetSheet,
  type SpreadsheetWorkbook,
  type ImportPreviewIssue,
  type ImportPreviewStatus,
} from "./imports";
import { assertLedgerIsValid, sortLedgerTransactions, toNumber, type LedgerTransaction } from "./portfolio";

export type ParsedXtbPosition = {
  sourceRow: number;
  broker: Broker;
  source: "POSITION_TABLE" | "CASH_OPERATION";
  externalId: string;
  symbol: string;
  currency: string;
  assetClass: AssetClass;
  portfolioEligible: boolean;
  exclusionReason?: string | null;
  category?: string | null;
  positionState: ImportedPositionState;
  direction: TransactionType;
  openTime: Date;
  closeTime: Date | null;
  volume: number;
  openPrice: number;
  closePrice: number | null;
  profit: number | null;
};

export type XtbPreviewPosition = ParsedXtbPosition & {
  status: ImportPreviewStatus;
  issues: ImportPreviewIssue[];
};

export type XtbPreviewTransaction = {
  symbol: string;
  date: string;
  type: TransactionType;
  quantity: number;
  price: number;
  fee: number;
  currency: string;
  broker: Broker;
  externalId: string;
  leg: "OPEN" | "CLOSE";
  portfolioEligible: boolean;
  exclusionReason: string | null;
  status: ImportPreviewStatus;
};

const REQUIRED_HEADERS: Record<string, readonly string[]> = {
  symbol: ["ticker", "symbol", "instrument"],
  category: ["category", "assetclass", "assettype"],
  positionId: ["positionid", "positionidnumber", "position", "positionno", "order"],
  openTime: ["opentime", "opentimeutc", "open"],
  closeTime: ["closetime", "closetimeutc", "close"],
  volume: ["volume", "lots", "lot"],
  openPrice: ["openprice", "openpriceexecuted", "openrate"],
  closePrice: ["closeprice", "closepriceexecuted", "closerate"],
  profit: ["profitloss", "profit", "grossprofit", "pl", "pnl"],
  currency: ["currency", "profitcurrency", "assetcurrency"],
  comment: ["comment", "description", "notes"],
  direction: ["type", "cmd", "command", "ordertype"],
};

const BASE_REQUIRED_HEADER_FIELDS = [
  "symbol",
  "openTime",
  "volume",
  "openPrice",
  "direction",
] as const;

const CLOSED_REQUIRED_HEADER_FIELDS = [...BASE_REQUIRED_HEADER_FIELDS, "closeTime", "closePrice"] as const;

const HEADER_FIELD_LABELS: Record<
  (typeof CLOSED_REQUIRED_HEADER_FIELDS)[number] | "currency" | "profit" | "category",
  string
> = {
  symbol: "symbol",
  openTime: "open time",
  closeTime: "close time",
  volume: "volume",
  openPrice: "open price",
  closePrice: "close price",
  direction: "type",
  category: "category",
  currency: "currency",
  profit: "profit",
};

const PRAGUE_TIME_ZONE = "Europe/Prague";

const MARKET_SUFFIX_CURRENCY_MAP: Record<string, string> = {
  AU: "AUD",
  BE: "EUR",
  CA: "CAD",
  CH: "CHF",
  CZ: "CZK",
  DE: "EUR",
  DK: "DKK",
  ES: "EUR",
  EU: "EUR",
  FI: "EUR",
  FR: "EUR",
  HK: "HKD",
  HU: "HUF",
  IT: "EUR",
  JP: "JPY",
  NL: "EUR",
  NO: "NOK",
  PL: "PLN",
  RO: "RON",
  SE: "SEK",
  SG: "SGD",
  UK: "GBP",
  US: "USD",
  ZA: "ZAR",
};

const KNOWN_CURRENCY_CODES = new Set(Object.values(MARKET_SUFFIX_CURRENCY_MAP));
const ACCOUNT_CURRENCY_HEADERS = new Set(["basecurrency", "accountcurrency", "accountbasecurrency"]);

type HeaderField = keyof typeof REQUIRED_HEADERS;

type XtbColumnIndexes = Record<HeaderField, number>;

const CASH_OPERATION_HEADERS = {
  type: ["type"],
  instrument: ["instrument"],
  time: ["time"],
  id: ["id"],
  comment: ["comment"],
} as const;

type CashOperationField = keyof typeof CASH_OPERATION_HEADERS;

type CashOperationIndexes = Record<CashOperationField, number>;

type XtbSheetKind = ImportedPositionState | "UNKNOWN";

type XtbHeaderCandidate = {
  rowIndex: number;
  headers: string[];
  indexes: XtbColumnIndexes;
  score: number;
  matchedRequiredCount: number;
  matchedClosedCount: number;
  sheetKind: XtbSheetKind;
};

type CashOperationHeaderCandidate = {
  rowIndex: number;
  headers: string[];
  indexes: CashOperationIndexes;
  score: number;
};

type InstrumentMetadata = {
  symbol: string;
  category: string | null;
  assetClass: AssetClass;
  currency: string | null;
};

type XtbPositionIdentity = {
  source?: "POSITION_TABLE" | "CASH_OPERATION";
  externalId: string;
  symbol: string;
  currency: string;
  positionState: ImportedPositionState;
  direction: TransactionType;
  openTime: Date;
  closeTime: Date | null;
  volume: number | string;
  openPrice: number | string;
  closePrice: number | string | null;
};

const STORED_XTB_EXTERNAL_ID_PREFIX = "xtb|";

function extractRawExternalId(externalId: string): string {
  if (!externalId.startsWith(STORED_XTB_EXTERNAL_ID_PREFIX)) {
    return externalId;
  }

  const parts = externalId.split("|");

  if (parts.length < 3) {
    return externalId;
  }

  try {
    return decodeURIComponent(parts[1] ?? "");
  } catch {
    return parts[1] ?? externalId;
  }
}

export function extractStoredXtbFingerprint(externalId: string): string | null {
  if (!externalId.startsWith(STORED_XTB_EXTERNAL_ID_PREFIX)) {
    return null;
  }

  const parts = externalId.split("|");

  return parts.length >= 3 ? parts.slice(2).join("|") : null;
}

function normalizeFingerprintNumber(value: number | string | null): number | null {
  if (value === null) {
    return null;
  }

  return toNumber(value);
}

export function buildXtbPositionFingerprint(position: XtbPositionIdentity): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        broker: Broker.XTB,
        source: position.source ?? "POSITION_TABLE",
        externalId: extractRawExternalId(position.externalId),
        symbol: normalizeCell(position.symbol).toUpperCase(),
        currency: normalizeCell(position.currency).toUpperCase(),
        positionState: position.positionState,
        direction: position.direction,
        openTime: position.openTime.toISOString(),
        closeTime: position.closeTime?.toISOString() ?? null,
        volume: normalizeFingerprintNumber(position.volume),
        openPrice: normalizeFingerprintNumber(position.openPrice),
        closePrice: normalizeFingerprintNumber(position.closePrice),
      }),
    )
    .digest("hex");
}

export function buildStoredXtbExternalId(position: XtbPositionIdentity): string {
  return `${STORED_XTB_EXTERNAL_ID_PREFIX}${encodeURIComponent(extractRawExternalId(position.externalId))}|${buildXtbPositionFingerprint(position)}`;
}

function parseNumber(value: unknown, fieldName: string, rowNumber: number): number {
  if (typeof value === "number") {
    return value;
  }

  const input = normalizeCell(value);

  if (!input) {
    throw new AppError(400, "XTB_PARSE_ERROR", `Missing ${fieldName} at row ${rowNumber}`);
  }

  const normalized =
    input.includes(",") && input.includes(".")
      ? input.replace(/,/g, "")
      : input.includes(",")
        ? input.replace(",", ".")
        : input;

  const numeric = Number(normalized.replace(/\s+/g, ""));

  if (!Number.isFinite(numeric)) {
    throw new AppError(400, "XTB_PARSE_ERROR", `Invalid ${fieldName} at row ${rowNumber}`);
  }

  return numeric;
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const offset = parts.find((part) => part.type === "timeZoneName")?.value;

  if (!offset || offset === "GMT") {
    return 0;
  }

  const match = offset.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);

  if (!match) {
    throw new AppError(500, "IMPORT_PARSE_ERROR", `Unable to resolve timezone offset for ${timeZone}`);
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? "0");

  return sign * (hours * 60 + minutes);
}

function parsePragueLocalDate(input: string, fieldName: string, rowNumber: number): Date {
  const match = input.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/,
  );

  if (!match) {
    throw new AppError(400, "XTB_PARSE_ERROR", `Invalid ${fieldName} at row ${rowNumber}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? "0");
  const millisecond = Number((match[7] ?? "0").padEnd(3, "0"));
  const utcTimestamp = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  let adjustedTimestamp = utcTimestamp;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const offsetMinutes = getTimeZoneOffsetMinutes(new Date(adjustedTimestamp), PRAGUE_TIME_ZONE);
    const nextTimestamp = utcTimestamp - offsetMinutes * 60_000;

    if (nextTimestamp === adjustedTimestamp) {
      break;
    }

    adjustedTimestamp = nextTimestamp;
  }

  return new Date(adjustedTimestamp);
}

function parseUtcDateString(input: string, fieldName: string, rowNumber: number): Date {
  const match = input.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/,
  );

  if (!match) {
    throw new AppError(400, "XTB_PARSE_ERROR", `Invalid ${fieldName} at row ${rowNumber}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? "0");
  const millisecond = Number((match[7] ?? "0").padEnd(3, "0"));

  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
}

function parseDate(value: unknown, fieldName: string, rowNumber: number, treatAsUtc = false): Date {
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);

    if (!parsed) {
      throw new AppError(400, "XTB_PARSE_ERROR", `Invalid ${fieldName} at row ${rowNumber}`);
    }

    return new Date(
      Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.floor(parsed.S)),
    );
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new AppError(400, "XTB_PARSE_ERROR", `Invalid ${fieldName} at row ${rowNumber}`);
    }

    return value;
  }

  const input = normalizeCell(value);

  if (!input) {
    throw new AppError(400, "XTB_PARSE_ERROR", `Missing ${fieldName} at row ${rowNumber}`);
  }

  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(input)) {
    const date = new Date(input);

    if (Number.isNaN(date.getTime())) {
      throw new AppError(400, "XTB_PARSE_ERROR", `Invalid ${fieldName} at row ${rowNumber}`);
    }

    return date;
  }

  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(input)) {
    return treatAsUtc
      ? parseUtcDateString(input, fieldName, rowNumber)
      : parsePragueLocalDate(input, fieldName, rowNumber);
  }

  const date = new Date(input);

  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, "XTB_PARSE_ERROR", `Invalid ${fieldName} at row ${rowNumber}`);
  }

  return date;
}

function parseDirection(value: unknown, rowNumber: number): TransactionType {
  if (typeof value === "number") {
    if (value === 0) {
      return TransactionType.BUY;
    }

    if (value === 1) {
      return TransactionType.SELL;
    }
  }

  const normalized = String(value ?? "").trim().toLowerCase();

  if (normalized === "buy" || normalized === "0") {
    return TransactionType.BUY;
  }

  if (normalized === "sell" || normalized === "1") {
    return TransactionType.SELL;
  }

  throw new AppError(400, "XTB_PARSE_ERROR", `Unsupported XTB direction at row ${rowNumber}`);
}

function findColumnIndex(headers: string[], aliases: readonly string[]): number {
  for (const alias of aliases) {
    const index = headers.indexOf(alias);

    if (index !== -1) {
      return index;
    }
  }

  return -1;
}

function buildHeaderIndexes(headers: string[]): XtbColumnIndexes {
  return {
    symbol: findColumnIndex(headers, REQUIRED_HEADERS.symbol),
    category: findColumnIndex(headers, REQUIRED_HEADERS.category),
    positionId: findColumnIndex(headers, REQUIRED_HEADERS.positionId),
    openTime: findColumnIndex(headers, REQUIRED_HEADERS.openTime),
    closeTime: findColumnIndex(headers, REQUIRED_HEADERS.closeTime),
    volume: findColumnIndex(headers, REQUIRED_HEADERS.volume),
    openPrice: findColumnIndex(headers, REQUIRED_HEADERS.openPrice),
    closePrice: findColumnIndex(headers, REQUIRED_HEADERS.closePrice),
    profit: findColumnIndex(headers, REQUIRED_HEADERS.profit),
    currency: findColumnIndex(headers, REQUIRED_HEADERS.currency),
    comment: findColumnIndex(headers, REQUIRED_HEADERS.comment),
    direction: findColumnIndex(headers, REQUIRED_HEADERS.direction),
  };
}

function buildCashOperationIndexes(headers: string[]): CashOperationIndexes {
  return {
    type: findColumnIndex(headers, CASH_OPERATION_HEADERS.type),
    instrument: findColumnIndex(headers, CASH_OPERATION_HEADERS.instrument),
    time: findColumnIndex(headers, CASH_OPERATION_HEADERS.time),
    id: findColumnIndex(headers, CASH_OPERATION_HEADERS.id),
    comment: findColumnIndex(headers, CASH_OPERATION_HEADERS.comment),
  };
}

function buildCashOperationHeaderCandidate(row: unknown[], rowIndex: number): CashOperationHeaderCandidate | null {
  const headers = row.map((value) => canonicalizeHeader(value));
  const indexes = buildCashOperationIndexes(headers);
  const matchedCount = Object.values(indexes).filter((index) => index !== -1).length;

  if (matchedCount < 4 || indexes.type === -1 || indexes.instrument === -1 || indexes.time === -1) {
    return null;
  }

  return {
    rowIndex,
    headers,
    indexes,
    score: matchedCount,
  };
}

function findCashOperationHeaderCandidate(rows: unknown[][]): CashOperationHeaderCandidate | null {
  let bestCandidate: CashOperationHeaderCandidate | null = null;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];

    if (!row || row.every(isBlankCell)) {
      continue;
    }

    const candidate = buildCashOperationHeaderCandidate(row, rowIndex);

    if (!candidate) {
      continue;
    }

    if (!bestCandidate || candidate.score > bestCandidate.score || candidate.rowIndex < bestCandidate.rowIndex) {
      bestCandidate = candidate;
    }
  }

  return bestCandidate;
}

function inferSheetKind(headers: string[]): XtbSheetKind {
  const normalized = headers.join("");

  if (normalized.includes("closedposition")) {
    return ImportedPositionState.CLOSED;
  }

  if (normalized.includes("openposition")) {
    return ImportedPositionState.OPEN;
  }

  return "UNKNOWN";
}

function buildHeaderCandidate(row: unknown[], rowIndex: number, sheetName?: string): XtbHeaderCandidate | null {
  const headers = row.map((value) => canonicalizeHeader(value));
  const indexes = buildHeaderIndexes(headers);
  const matchedRequiredCount = BASE_REQUIRED_HEADER_FIELDS.filter((field) => indexes[field] !== -1).length;
  const matchedClosedCount = CLOSED_REQUIRED_HEADER_FIELDS.filter((field) => indexes[field] !== -1).length;
  const optionalCount = (indexes.currency !== -1 ? 1 : 0) + (indexes.profit !== -1 ? 1 : 0);
  const score = matchedRequiredCount * 10 + matchedClosedCount * 5 + optionalCount;
  const hasIdentityColumns = indexes.symbol !== -1;
  const inferredBySheetName = inferSheetNameKind(sheetName);
  const inferredByHeaders = inferSheetKind(headers);
  const sheetKind = inferredBySheetName !== "UNKNOWN" ? inferredBySheetName : inferredByHeaders;

  if (!hasIdentityColumns || matchedRequiredCount < 3) {
    return null;
  }

  return {
    rowIndex,
    headers,
    indexes,
    score,
    matchedRequiredCount,
    matchedClosedCount,
    sheetKind,
  };
}

function findBestHeaderCandidate(rows: unknown[][], sheetName?: string): XtbHeaderCandidate | null {
  let bestCandidate: XtbHeaderCandidate | null = null;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];

    if (!row || row.every(isBlankCell)) {
      continue;
    }

    const candidate = buildHeaderCandidate(row, rowIndex, sheetName);

    if (!candidate) {
      continue;
    }

    if (
      !bestCandidate ||
      candidate.matchedRequiredCount > bestCandidate.matchedRequiredCount ||
      (candidate.matchedRequiredCount === bestCandidate.matchedRequiredCount &&
        candidate.score > bestCandidate.score) ||
      (candidate.matchedRequiredCount === bestCandidate.matchedRequiredCount &&
        candidate.score === bestCandidate.score &&
        candidate.rowIndex < bestCandidate.rowIndex)
    ) {
      bestCandidate = candidate;
    }
  }

  return bestCandidate;
}

function inferSheetNameKind(name?: string): XtbSheetKind {
  const normalized = canonicalizeHeader(name);

  if (normalized.includes("closedposition")) {
    return ImportedPositionState.CLOSED;
  }

  if (normalized.includes("openposition")) {
    return ImportedPositionState.OPEN;
  }

  return "UNKNOWN";
}

function getMissingRequiredField(
  indexes: XtbColumnIndexes,
  positionState: ImportedPositionState,
): (typeof CLOSED_REQUIRED_HEADER_FIELDS)[number] | null {
  const requiredFields =
    positionState === ImportedPositionState.CLOSED ? CLOSED_REQUIRED_HEADER_FIELDS : BASE_REQUIRED_HEADER_FIELDS;

  return requiredFields.find((field) => indexes[field] === -1) ?? null;
}

function describeMissingField(field: (typeof CLOSED_REQUIRED_HEADER_FIELDS)[number] | "currency"): string {
  return HEADER_FIELD_LABELS[field];
}

function scoreSheetName(name: string): number {
  const normalized = canonicalizeHeader(name);

  if (normalized.includes("closedpositionhistory")) {
    return 100;
  }

  if (normalized.includes("closedposition")) {
    return 60;
  }

  if (normalized.includes("openposition")) {
    return 55;
  }

  if (normalized.includes("positionhistory")) {
    return 30;
  }

  if (normalized.includes("history")) {
    return 10;
  }

  return 0;
}

function selectWorkbookSheet(workbook: SpreadsheetWorkbook): {
  sheet: SpreadsheetSheet;
  header: XtbHeaderCandidate;
} | null {
  let bestMatch: { sheet: SpreadsheetSheet; header: XtbHeaderCandidate; totalScore: number } | null = null;

  for (const sheet of workbook.sheets) {
    const header = findBestHeaderCandidate(sheet.rows, sheet.name);

    if (!header) {
      continue;
    }

    const inferredState =
      header.sheetKind === ImportedPositionState.OPEN ? ImportedPositionState.OPEN : ImportedPositionState.CLOSED;
    const hasAllRequiredFields = getMissingRequiredField(header.indexes, inferredState) === null;
    const totalScore =
      (hasAllRequiredFields ? 1_000 : 0) + header.score + scoreSheetName(sheet.name);

    if (!bestMatch || totalScore > bestMatch.totalScore) {
      bestMatch = { sheet, header, totalScore };
    }
  }

  return bestMatch ? { sheet: bestMatch.sheet, header: bestMatch.header } : null;
}

function inferCurrencyFromSymbol(symbol: string): string | null {
  const normalizedSymbol = normalizeCell(symbol).toUpperCase();

  if (!normalizedSymbol) {
    return null;
  }

  if (/^[A-Z]{6}$/.test(normalizedSymbol)) {
    return normalizedSymbol.slice(-3);
  }

  const slashPairMatch = normalizedSymbol.match(/\/([A-Z]{3})$/);

  if (slashPairMatch) {
    return slashPairMatch[1];
  }

  const marketSuffixMatch = normalizedSymbol.match(/\.([A-Z]{2,4})$/);

  if (marketSuffixMatch) {
    return MARKET_SUFFIX_CURRENCY_MAP[marketSuffixMatch[1]] ?? null;
  }

  const currencySuffixMatch = normalizedSymbol.match(/[._-]([A-Z]{3})$/);

  if (currencySuffixMatch) {
    return currencySuffixMatch[1];
  }

  return null;
}

function extractCurrencyToken(value: unknown): string | null {
  const tokens = normalizeCell(value).toUpperCase().match(/\b[A-Z]{3}\b/g) ?? [];

  for (const token of tokens) {
    if (KNOWN_CURRENCY_CODES.has(token)) {
      return token;
    }
  }

  return null;
}

function extractTickerToken(value: unknown): string | null {
  const match = normalizeCell(value).toUpperCase().match(/\b([A-Z0-9-]+\.[A-Z0-9]{2,4})\b/);

  return match?.[1] ?? null;
}

function normalizeInstrumentName(value: unknown): string {
  return normalizeCell(value).toLowerCase();
}

function inferAccountCurrencyFromRows(rows: unknown[][]): string | null {
  for (const row of rows.slice(0, 12)) {
    for (let index = 0; index < row.length; index += 1) {
      if (!ACCOUNT_CURRENCY_HEADERS.has(canonicalizeHeader(row[index]))) {
        continue;
      }

      const sameCellCurrency = extractCurrencyToken(row[index]);

      if (sameCellCurrency) {
        return sameCellCurrency;
      }

      for (let valueIndex = index + 1; valueIndex < row.length; valueIndex += 1) {
        const nextCurrency = extractCurrencyToken(row[valueIndex]);

        if (nextCurrency) {
          return nextCurrency;
        }
      }
    }
  }

  return null;
}

function inferAccountCurrencyFromWorkbook(workbook: SpreadsheetWorkbook): string | null {
  for (const sheet of workbook.sheets) {
    const currency = inferAccountCurrencyFromRows(sheet.rows);

    if (currency) {
      return currency;
    }
  }

  return null;
}

function inferAccountCurrencyFromFileName(fileName?: string): string | null {
  const normalizedName = normalizeCell(fileName).toUpperCase().split(/[\\/]/).pop() ?? "";
  const match = normalizedName.match(/^([A-Z]{3})[_\s-]/);

  if (!match) {
    return null;
  }

  return KNOWN_CURRENCY_CODES.has(match[1]) ? match[1] : null;
}

function classifyAssetClass(category: string | null, symbol: string): AssetClass {
  const normalizedCategory = normalizeCell(category).toLowerCase();
  const normalizedSymbol = normalizeCell(symbol).toUpperCase();

  if (normalizedCategory.includes("etf")) {
    return AssetClass.ETF;
  }

  if (
    normalizedCategory.includes("stock") ||
    normalizedCategory.includes("share") ||
    normalizedCategory.includes("equity")
  ) {
    return AssetClass.STOCK;
  }

  if (normalizedCategory.includes("cfd")) {
    return AssetClass.CFD;
  }

  if (normalizedCategory.includes("forex") || /^[A-Z]{6}$/.test(normalizedSymbol)) {
    return AssetClass.FOREX;
  }

  if (
    normalizedCategory.includes("crypto") ||
    ["BTC", "ETH", "ETHEREUM", "BITCOIN", "SOL", "XRP", "LTC"].includes(normalizedSymbol)
  ) {
    return AssetClass.CRYPTO;
  }

  if (/\.[A-Z]{2,4}$/.test(normalizedSymbol)) {
    return AssetClass.STOCK;
  }

  return AssetClass.UNKNOWN;
}

function resolvePortfolioEligibility(options: {
  assetClass: AssetClass;
  direction: TransactionType;
}): { portfolioEligible: boolean; exclusionReason: string | null } {
  if (options.direction !== TransactionType.BUY) {
    return {
      portfolioEligible: false,
      exclusionReason: "Short or sell-first XTB positions are imported only for audit and excluded from portfolio metrics",
    };
  }

  if (options.assetClass === AssetClass.STOCK || options.assetClass === AssetClass.ETF) {
    return {
      portfolioEligible: true,
      exclusionReason: null,
    };
  }

  return {
    portfolioEligible: false,
    exclusionReason: `XTB ${options.assetClass} instruments are imported only for audit and excluded from portfolio metrics`,
  };
}

function buildSyntheticExternalId(options: {
  symbol: string;
  direction: TransactionType;
  openTime: Date;
  closeTime: Date;
  volume: number;
  openPrice: number;
  closePrice: number;
  profit: number;
}): string {
  return `generated:${createHash("sha256")
    .update(
      JSON.stringify({
        broker: Broker.XTB,
        symbol: options.symbol,
        direction: options.direction,
        openTime: options.openTime.toISOString(),
        closeTime: options.closeTime.toISOString(),
        volume: options.volume,
        openPrice: options.openPrice,
        closePrice: options.closePrice,
        profit: options.profit,
      }),
    )
    .digest("hex")}`;
}

function parseCurrency(options: {
  row: unknown[];
  indexes: XtbColumnIndexes;
  symbol: string;
  rowNumber: number;
  accountCurrency?: string | null;
}): string {
  if (options.indexes.currency !== -1) {
    const rawCurrency = normalizeCell(options.row[options.indexes.currency]).toUpperCase();

    if (rawCurrency) {
      return rawCurrency;
    }
  }

  if (options.indexes.comment !== -1) {
    const commentCurrency = extractCurrencyToken(options.row[options.indexes.comment]);

    if (commentCurrency) {
      return commentCurrency;
    }
  }

  const inferredCurrency = inferCurrencyFromSymbol(options.symbol);

  if (inferredCurrency) {
    return inferredCurrency;
  }

  if (options.accountCurrency) {
    return options.accountCurrency;
  }

  throw new AppError(
    400,
    "XTB_PARSE_ERROR",
    `Missing currency at row ${options.rowNumber}; add a currency column, comment currency, account currency, or a supported XTB symbol suffix`,
  );
}

function collectInstrumentMetadataFromPositionSheet(
  rows: unknown[][],
  header: XtbHeaderCandidate,
  metadata: Map<string, InstrumentMetadata>,
): void {
  const instrumentIndex = findColumnIndex(header.headers, ["instrument"]);

  if (instrumentIndex === -1 || header.indexes.symbol === -1) {
    return;
  }

  for (let index = header.rowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];

    if (!row || row.every(isBlankCell)) {
      continue;
    }

    const instrument = normalizeInstrumentName(row[instrumentIndex]);
    const symbol = normalizeCell(row[header.indexes.symbol]).toUpperCase();

    if (!instrument || !symbol) {
      continue;
    }

    const category =
      header.indexes.category === -1 ? null : normalizeCell(row[header.indexes.category]).toUpperCase() || null;
    metadata.set(instrument, {
      symbol,
      category,
      assetClass: classifyAssetClass(category, symbol),
      currency: inferCurrencyFromSymbol(symbol),
    });
  }
}

function collectInstrumentMetadataFromCashSheet(
  rows: unknown[][],
  header: CashOperationHeaderCandidate,
  metadata: Map<string, InstrumentMetadata>,
): void {
  for (let index = header.rowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];

    if (!row || row.every(isBlankCell)) {
      continue;
    }

    const instrument = normalizeInstrumentName(row[header.indexes.instrument]);
    const symbol = extractTickerToken(row[header.indexes.comment]);

    if (!instrument || !symbol || metadata.has(instrument)) {
      continue;
    }

    metadata.set(instrument, {
      symbol,
      category: "STOCK",
      assetClass: classifyAssetClass("STOCK", symbol),
      currency: inferCurrencyFromSymbol(symbol),
    });
  }
}

function buildInstrumentMetadataMap(workbook: SpreadsheetWorkbook): Map<string, InstrumentMetadata> {
  const metadata = new Map<string, InstrumentMetadata>();

  for (const sheet of workbook.sheets) {
    const positionHeader = findBestHeaderCandidate(sheet.rows, sheet.name);

    if (positionHeader) {
      collectInstrumentMetadataFromPositionSheet(sheet.rows, positionHeader, metadata);
    }

    const cashHeader = findCashOperationHeaderCandidate(sheet.rows);

    if (cashHeader) {
      collectInstrumentMetadataFromCashSheet(sheet.rows, cashHeader, metadata);
    }
  }

  return metadata;
}

function parseCashOperationTradeDetails(comment: unknown, rowNumber: number): { quantity: number; price: number } {
  const normalizedComment = normalizeCell(comment).toUpperCase();
  const match = normalizedComment.match(
    /\b(?:OPEN|CLOSE)\s+BUY\s+([0-9]+(?:[.,][0-9]+)?)(?:\/[0-9]+(?:[.,][0-9]+)?)?\s+@\s+([0-9]+(?:[.,][0-9]+)?)/,
  );

  if (!match) {
    throw new AppError(400, "XTB_PARSE_ERROR", `Unsupported cash-operation comment at row ${rowNumber}`);
  }

  return {
    quantity: parseNumber(match[1], "quantity", rowNumber),
    price: parseNumber(match[2], "price", rowNumber),
  };
}

function parseCashOperationsRows(
  rows: unknown[][],
  header: CashOperationHeaderCandidate,
  instrumentMetadata: Map<string, InstrumentMetadata>,
  accountCurrency?: string | null,
): ParsedXtbPosition[] {
  const parsed: ParsedXtbPosition[] = [];

  for (let index = header.rowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNumber = index + 1;

    if (!row || row.every(isBlankCell)) {
      continue;
    }

    const rowType = normalizeCell(row[header.indexes.type]).toLowerCase();

    if (rowType !== "stock purchase" && rowType !== "stock sell") {
      continue;
    }

    const instrument = normalizeInstrumentName(row[header.indexes.instrument]);
    const resolved = instrumentMetadata.get(instrument);

    if (!resolved) {
      throw new AppError(
        400,
        "XTB_PARSE_ERROR",
        `Unable to resolve a ticker for cash-operation instrument "${normalizeCell(row[header.indexes.instrument])}" at row ${rowNumber}`,
      );
    }

    const direction = rowType === "stock purchase" ? TransactionType.BUY : TransactionType.SELL;
    const occurredAt = parseDate(row[header.indexes.time], "time", rowNumber);
    const { quantity, price } = parseCashOperationTradeDetails(row[header.indexes.comment], rowNumber);
    const currency = resolved.currency ?? inferCurrencyFromSymbol(resolved.symbol) ?? accountCurrency;

    if (!currency) {
      throw new AppError(400, "XTB_PARSE_ERROR", `Missing currency at row ${rowNumber}`);
    }

    parsed.push({
      sourceRow: rowNumber,
      broker: Broker.XTB,
      source: "CASH_OPERATION",
      externalId: normalizeCell(header.indexes.id === -1 ? null : row[header.indexes.id]) || `cash-row-${rowNumber}`,
      symbol: resolved.symbol,
      currency,
      assetClass: resolved.assetClass,
      portfolioEligible: resolved.assetClass === AssetClass.STOCK || resolved.assetClass === AssetClass.ETF,
      exclusionReason:
        resolved.assetClass === AssetClass.STOCK || resolved.assetClass === AssetClass.ETF
          ? null
          : `XTB ${resolved.assetClass} instruments are imported only for audit and excluded from portfolio metrics`,
      category: resolved.category,
      positionState: direction === TransactionType.BUY ? ImportedPositionState.OPEN : ImportedPositionState.CLOSED,
      direction,
      openTime: occurredAt,
      closeTime: null,
      volume: quantity,
      openPrice: price,
      closePrice: null,
      profit: null,
    });
  }

  return parsed;
}

function parseCashOperationsWorkbook(
  workbook: SpreadsheetWorkbook,
  instrumentMetadata: Map<string, InstrumentMetadata>,
  accountCurrency?: string | null,
): ParsedXtbPosition[] {
  return workbook.sheets.flatMap((sheet) => {
    const header = findCashOperationHeaderCandidate(sheet.rows);

    if (!header) {
      return [];
    }

    return parseCashOperationsRows(sheet.rows, header, instrumentMetadata, accountCurrency);
  });
}

function parseRowsFromHeader(
  rows: unknown[][],
  header: XtbHeaderCandidate,
  options?: {
    sheetName?: string;
    accountCurrency?: string | null;
  },
): ParsedXtbPosition[] {
  const indexes = header.indexes;
  const inferredState =
    header.sheetKind === ImportedPositionState.OPEN ? ImportedPositionState.OPEN : ImportedPositionState.CLOSED;
  const missingField = getMissingRequiredField(header.indexes, inferredState);

  if (missingField) {
    const sheetContext = options?.sheetName ? ` in sheet "${options.sheetName}"` : "";

    throw new AppError(
      400,
      "XTB_PARSE_ERROR",
      `The XTB workbook is missing the required ${describeMissingField(missingField)} column${sheetContext}`,
    );
  }

  const parsed: ParsedXtbPosition[] = [];
  const openTimeIsUtc = indexes.openTime !== -1 && header.headers[indexes.openTime]?.includes("utc");
  const closeTimeIsUtc = indexes.closeTime !== -1 && header.headers[indexes.closeTime]?.includes("utc");

  for (let index = header.rowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNumber = index + 1;

    if (!row || row.every(isBlankCell)) {
      continue;
    }

    const symbol = normalizeCell(row[indexes.symbol]).toUpperCase();

    if (!symbol) {
      continue;
    }

    const direction = parseDirection(row[indexes.direction], rowNumber);
    const openTime = parseDate(row[indexes.openTime], "open time", rowNumber, openTimeIsUtc);
    const volume = parseNumber(row[indexes.volume], "volume", rowNumber);
    const openPrice = parseNumber(row[indexes.openPrice], "open price", rowNumber);
    const closeTime =
      inferredState === ImportedPositionState.CLOSED
        ? parseDate(row[indexes.closeTime], "close time", rowNumber, closeTimeIsUtc)
        : null;
    const closePrice =
      inferredState === ImportedPositionState.CLOSED
        ? parseNumber(row[indexes.closePrice], "close price", rowNumber)
        : null;
    const profit = indexes.profit === -1 ? null : parseNumber(row[indexes.profit], "profit", rowNumber);
    const externalId = normalizeCell(indexes.positionId === -1 ? null : row[indexes.positionId]);
    const category = indexes.category === -1 ? null : normalizeCell(row[indexes.category]).toUpperCase() || null;
    const assetClass = classifyAssetClass(category, symbol);
    const { portfolioEligible, exclusionReason } = resolvePortfolioEligibility({
      assetClass,
      direction,
    });

    parsed.push({
      sourceRow: rowNumber,
      broker: Broker.XTB,
      source: "POSITION_TABLE",
      externalId:
        externalId ||
        buildSyntheticExternalId({
          symbol,
          direction,
          openTime,
          closeTime: closeTime ?? openTime,
          volume,
          openPrice,
          closePrice: closePrice ?? openPrice,
          profit: profit ?? 0,
        }),
      symbol,
      currency: parseCurrency({
        row,
        indexes,
        symbol,
        rowNumber,
        accountCurrency: options?.accountCurrency,
      }),
      assetClass,
      portfolioEligible,
      exclusionReason,
      category,
      positionState: inferredState,
      direction,
      openTime,
      closeTime,
      volume,
      openPrice,
      closePrice,
      profit,
    });
  }

  if (parsed.length === 0) {
    throw new AppError(400, "XTB_PARSE_ERROR", "No XTB data rows were found after the header");
  }

  return parsed;
}

export function findXtbHeaderRow(rows: unknown[][]): number {
  return findBestHeaderCandidate(rows)?.rowIndex ?? -1;
}

export function canParseXtbRows(rows: unknown[][]): boolean {
  const header = findBestHeaderCandidate(rows);

  if (!header) {
    return false;
  }

  const inferredState =
    header.sheetKind === ImportedPositionState.OPEN ? ImportedPositionState.OPEN : ImportedPositionState.CLOSED;

  return getMissingRequiredField(header.indexes, inferredState) === null;
}

export function canParseXtbWorkbook(workbook: SpreadsheetWorkbook): boolean {
  if (workbook.sheets.some((sheet) => findCashOperationHeaderCandidate(sheet.rows) !== null)) {
    return true;
  }

  return workbook.sheets.some((sheet) => {
    const header = findBestHeaderCandidate(sheet.rows, sheet.name);

    if (!header) {
      return false;
    }

    const inferredState =
      header.sheetKind === ImportedPositionState.OPEN ? ImportedPositionState.OPEN : ImportedPositionState.CLOSED;

    return getMissingRequiredField(header.indexes, inferredState) === null;
  });
}

export function parseXtbRows(rows: unknown[][]): ParsedXtbPosition[] {
  const header = findBestHeaderCandidate(rows);

  if (!header) {
    throw new AppError(400, "XTB_PARSE_ERROR", "Unable to find the XTB header row");
  }

  return parseRowsFromHeader(rows, header, {
    accountCurrency: inferAccountCurrencyFromRows(rows),
  });
}

export function parseXtbWorkbook(buffer: Buffer, options?: { fileName?: string }): ParsedXtbPosition[] {
  const workbook = readSpreadsheetWorkbook(buffer);
  const accountCurrency =
    inferAccountCurrencyFromFileName(options?.fileName) ?? inferAccountCurrencyFromWorkbook(workbook);
  const instrumentMetadata = buildInstrumentMetadataMap(workbook);
  const cashOperationRows = parseCashOperationsWorkbook(workbook, instrumentMetadata, accountCurrency);

  if (cashOperationRows.length > 0) {
    return cashOperationRows;
  }

  const parsed = workbook.sheets.flatMap((sheet) => {
    const header = findBestHeaderCandidate(sheet.rows, sheet.name);

    if (!header) {
      return [];
    }

    const inferredState =
      header.sheetKind === ImportedPositionState.OPEN ? ImportedPositionState.OPEN : ImportedPositionState.CLOSED;

    if (getMissingRequiredField(header.indexes, inferredState) !== null) {
      return [];
    }

    return parseRowsFromHeader(sheet.rows, header, {
      sheetName: sheet.name,
      accountCurrency,
    });
  });

  if (parsed.length === 0) {
    const selection = selectWorkbookSheet(workbook);

    if (selection) {
      const inferredState =
        selection.header.sheetKind === ImportedPositionState.OPEN
          ? ImportedPositionState.OPEN
          : ImportedPositionState.CLOSED;
      const missingField = getMissingRequiredField(selection.header.indexes, inferredState);

      if (missingField) {
        throw new AppError(
          400,
          "XTB_PARSE_ERROR",
          `The XTB workbook is missing the required ${describeMissingField(missingField)} column in sheet "${selection.sheet.name}"`,
        );
      }
    }

    throw new AppError(
      400,
      "XTB_PARSE_ERROR",
      "Unable to find an XTB cash-operations, open-position, or closed-position table in the uploaded workbook",
    );
  }

  return parsed;
}

export function buildXtbPreview(options: {
  parsedPositions: ParsedXtbPosition[];
  existingFingerprints: Set<string>;
  existingAssets: Map<string, Pick<Asset, "id" | "currency">>;
  existingTransactionsBySymbol?: Map<
    string,
    Array<
      Pick<Transaction, "id" | "assetId" | "type" | "quantity" | "price" | "fee" | "occurredAt" | "createdAt">
    >
  >;
}): {
  positions: XtbPreviewPosition[];
  transactions: XtbPreviewTransaction[];
  summary: {
    positionCount: number;
    readyPositionCount: number;
    includedPositionCount: number;
    excludedPositionCount: number;
    duplicateCount: number;
    invalidCount: number;
    transactionCount: number;
  };
} {
  const seenFingerprints = new Set<string>();
  const positions = options.parsedPositions.map((position) => {
    const issues: ImportPreviewIssue[] = [];
    const fingerprint = buildXtbPositionFingerprint(position);

    if (seenFingerprints.has(fingerprint)) {
      issues.push({
        code: "DUPLICATE_IN_FILE",
        message: `Position ${position.externalId} appears multiple times in this file`,
      });
    }

    seenFingerprints.add(fingerprint);

    if (options.existingFingerprints.has(fingerprint)) {
      issues.push({
        code: "DUPLICATE_IN_DB",
        message: `Position ${position.externalId} has already been imported`,
      });
    }

    if (position.source === "POSITION_TABLE" && position.direction !== TransactionType.BUY) {
      issues.push({
        code: "UNSUPPORTED_DIRECTION",
        message: "Short or sell-first XTB positions are unsupported and excluded from portfolio imports",
      });
    }

    const existingAsset = options.existingAssets.get(position.symbol);

    if (position.portfolioEligible && existingAsset && existingAsset.currency !== position.currency) {
      issues.push({
        code: "CURRENCY_MISMATCH",
        message: `Existing asset ${position.symbol} uses ${existingAsset.currency}, but the XTB row uses ${position.currency}`,
      });
    }

    if (!position.portfolioEligible && position.exclusionReason && position.direction === TransactionType.BUY) {
      issues.push({
        code: "EXCLUDED_FROM_PORTFOLIO",
        message: position.exclusionReason,
      });
    }

    const status =
      issues.some((issue) => issue.code === "CURRENCY_MISMATCH" || issue.code === "UNSUPPORTED_DIRECTION")
        ? "invalid"
        : issues.some((issue) => issue.code === "DUPLICATE_IN_DB" || issue.code === "DUPLICATE_IN_FILE")
          ? "duplicate"
          : "ready";

    return {
      ...position,
      status,
      issues,
    } satisfies XtbPreviewPosition;
  });

  if (positions.every((position) => position.source === "CASH_OPERATION")) {
    const candidateTransactions = new Map<
      string,
      Array<{ index: number; transaction: LedgerTransaction }>
    >();

    positions.forEach((position, index) => {
      if (
        position.status !== "ready" ||
        !position.portfolioEligible ||
        position.direction !== TransactionType.SELL
      ) {
        return;
      }

      const symbolTransactions = candidateTransactions.get(position.symbol) ?? [];
      symbolTransactions.push({
        index,
        transaction: {
          id: `${position.externalId}-${position.sourceRow}-cash-preview`,
          assetId: position.symbol,
          type: position.direction,
          quantity: position.volume,
          price: position.openPrice,
          fee: 0,
          occurredAt: position.openTime,
          createdAt: position.openTime,
        },
      });
      candidateTransactions.set(position.symbol, symbolTransactions);
    });

    positions.forEach((position, index) => {
      if (
        position.status !== "ready" ||
        !position.portfolioEligible ||
        position.direction !== TransactionType.BUY
      ) {
        return;
      }

      const symbolTransactions = candidateTransactions.get(position.symbol) ?? [];
      symbolTransactions.push({
        index,
        transaction: {
          id: `${position.externalId}-${position.sourceRow}-cash-preview`,
          assetId: position.symbol,
          type: position.direction,
          quantity: position.volume,
          price: position.openPrice,
          fee: 0,
          occurredAt: position.openTime,
          createdAt: position.openTime,
        },
      });
      candidateTransactions.set(position.symbol, symbolTransactions);
    });

    for (const [symbol, previewTransactions] of candidateTransactions.entries()) {
      const existingTransactions = options.existingTransactionsBySymbol?.get(symbol) ?? [];
      const merged = sortLedgerTransactions([
        ...existingTransactions,
        ...previewTransactions.map((entry) => entry.transaction),
      ]);
      let quantityHeld = 0;

      for (const transaction of merged) {
        const previewEntry = previewTransactions.find((entry) => entry.transaction.id === transaction.id);

        if (!previewEntry) {
          quantityHeld += transaction.type === TransactionType.BUY ? toNumber(transaction.quantity) : -toNumber(transaction.quantity);
          continue;
        }

        const quantity = toNumber(transaction.quantity);

        if (transaction.type === TransactionType.SELL && quantityHeld < quantity - 1e-8) {
          positions[previewEntry.index]?.issues.push({
            code: "UNSUPPORTED_DIRECTION",
            message: "Short or sell-first XTB positions are unsupported and excluded from portfolio imports",
          });
          positions[previewEntry.index] = {
            ...positions[previewEntry.index],
            status: "invalid",
          };
          continue;
        }

        quantityHeld += transaction.type === TransactionType.BUY ? quantity : -quantity;
      }
    }
  }

  const transactions = positions.flatMap((position) => {
    if (!position.portfolioEligible) {
      return [];
    }

    const rows: XtbPreviewTransaction[] =
      position.source === "CASH_OPERATION"
        ? [
            {
              symbol: position.symbol,
              date: position.openTime.toISOString(),
              type: position.direction,
              quantity: position.volume,
              price: position.openPrice,
              fee: 0,
              currency: position.currency,
              broker: Broker.XTB,
              externalId: position.externalId,
              leg: position.direction === TransactionType.BUY ? "OPEN" : "CLOSE",
              portfolioEligible: position.portfolioEligible,
              exclusionReason: position.exclusionReason ?? null,
              status: position.status,
            },
          ]
        : [
            {
              symbol: position.symbol,
              date: position.openTime.toISOString(),
              type: TransactionType.BUY,
              quantity: position.volume,
              price: position.openPrice,
              fee: 0,
              currency: position.currency,
              broker: Broker.XTB,
              externalId: position.externalId,
              leg: "OPEN",
              portfolioEligible: position.portfolioEligible,
              exclusionReason: position.exclusionReason ?? null,
              status: position.status,
            },
          ];

    if (position.source === "POSITION_TABLE" && position.closeTime && position.closePrice !== null) {
      rows.push({
        symbol: position.symbol,
        date: position.closeTime.toISOString(),
        type: TransactionType.SELL,
        quantity: position.volume,
        price: position.closePrice,
        fee: 0,
        currency: position.currency,
        broker: Broker.XTB,
        externalId: position.externalId,
        leg: "CLOSE",
        portfolioEligible: position.portfolioEligible,
        exclusionReason: position.exclusionReason ?? null,
        status: position.status,
      });
    }

    return rows;
  });

  return {
    positions,
    transactions,
    summary: {
      positionCount: positions.length,
      readyPositionCount: positions.filter((position) => position.status === "ready").length,
      includedPositionCount: positions.filter((position) => position.portfolioEligible).length,
      excludedPositionCount: positions.filter((position) => !position.portfolioEligible).length,
      duplicateCount: positions.filter((position) => position.status === "duplicate").length,
      invalidCount: positions.filter((position) => position.status === "invalid").length,
      transactionCount: transactions.length,
    },
  };
}

export function buildImportedLedgerTransactions(position: ParsedXtbPosition): Array<{
  importLeg: "OPEN" | "CLOSE";
  occurredAt: Date;
  type: TransactionType;
  quantity: number;
  price: number;
  fee: number;
  note: string;
}> {
  if (!position.portfolioEligible) {
    return [];
  }

  if (position.source === "CASH_OPERATION") {
    return [
      {
        importLeg: position.direction === TransactionType.BUY ? "OPEN" : "CLOSE",
        occurredAt: position.openTime,
        type: position.direction,
        quantity: position.volume,
        price: position.openPrice,
        fee: 0,
        note: `Imported from XTB cash operation ${position.externalId}`,
      },
    ];
  }

  const transactions: Array<{
    importLeg: "OPEN" | "CLOSE";
    occurredAt: Date;
    type: TransactionType;
    quantity: number;
    price: number;
    fee: number;
    note: string;
  }> = [
    {
      importLeg: "OPEN",
      occurredAt: position.openTime,
      type: TransactionType.BUY,
      quantity: position.volume,
      price: position.openPrice,
      fee: 0,
      note: `Imported from XTB position ${position.externalId} (open)`,
    },
  ];

  if (position.closeTime && position.closePrice !== null) {
    transactions.push({
      importLeg: "CLOSE",
      occurredAt: position.closeTime,
      type: TransactionType.SELL,
      quantity: position.volume,
      price: position.closePrice,
      fee: 0,
      note: `Imported from XTB position ${position.externalId} (close)`,
    });
  }

  return transactions;
}

export function assertImportedLedgerIsValid(options: {
  existingTransactions: Array<Pick<Transaction, "id" | "assetId" | "type" | "quantity" | "price" | "fee" | "occurredAt" | "createdAt">>;
  importedTransactions: Array<LedgerTransaction>;
}): void {
  assertLedgerIsValid(
    sortLedgerTransactions([...options.existingTransactions, ...options.importedTransactions]),
  );
}
