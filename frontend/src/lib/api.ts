export type TransactionType = "BUY" | "SELL";
export type Broker = "XTB" | "TRADING212";

export type Asset = {
  id: string;
  symbol: string;
  name: string;
  currency: string;
  assetClass: "STOCK" | "ETF" | "CFD" | "CRYPTO" | "FOREX" | "UNKNOWN";
  portfolioEligible: boolean;
  currentPrice: number | null;
  createdAt: string;
  updatedAt: string;
};

export type Transaction = {
  id: string;
  assetId: string;
  type: TransactionType;
  quantity: number;
  price: number;
  fee: number;
  occurredAt: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  asset: Pick<Asset, "id" | "symbol" | "name" | "currency">;
};

export type ImportPreviewIssue = {
  code:
    | "DUPLICATE_IN_DB"
    | "DUPLICATE_IN_FILE"
    | "CURRENCY_MISMATCH"
    | "UNSUPPORTED_DIRECTION"
    | "EXCLUDED_FROM_PORTFOLIO"
    | "UNSUPPORTED_ROW_TYPE"
    | "MISSING_REQUIRED_FIELD"
    | "INVALID_NUMBER"
    | "INVALID_DATE";
  message: string;
};

type BaseImportPreviewItem = {
  sourceRow: number;
  broker: Broker;
  externalId?: string | null;
  symbol: string;
  currency: string;
  status: "ready" | "duplicate" | "invalid";
  issues: ImportPreviewIssue[];
};

export type XtbImportPreviewItem = BaseImportPreviewItem & {
  broker: "XTB";
  source: "POSITION_TABLE" | "CASH_OPERATION";
  externalId: string;
  assetClass: "STOCK" | "ETF" | "CFD" | "CRYPTO" | "FOREX" | "UNKNOWN";
  portfolioEligible: boolean;
  exclusionReason?: string | null;
  category?: string | null;
  positionState: "OPEN" | "CLOSED";
  direction: TransactionType;
  openTime: string;
  closeTime: string | null;
  volume: number;
  openPrice: number;
  closePrice: number | null;
  profit: number | null;
};

export type Trading212ImportPreviewItem = BaseImportPreviewItem & {
  broker: "TRADING212";
  occurredAt: string | null;
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
  status: "ready" | "duplicate" | "invalid";
};

export type ImportPreview = {
  fileName: string;
  broker: Broker;
  items: ImportPreviewItem[];
  transactions: ImportPreviewTransaction[];
  summary: {
    itemCount: number;
    readyCount: number;
    includedCount?: number;
    excludedCount?: number;
    duplicateCount: number;
    invalidCount: number;
    transactionCount: number;
  };
};

export type Holding = {
  assetId: string;
  symbol: string;
  name: string;
  currency: string;
  assetClass: "STOCK" | "ETF" | "CFD" | "CRYPTO" | "FOREX" | "UNKNOWN";
  sector: string;
  region: string;
  continent: string;
  baseCurrency: "USD";
  fxRateToBase: number | null;
  quantity: number;
  averageCost: number;
  costBasis: number;
  costBasisBase: number | null;
  currentPrice: number | null;
  marketValue: number | null;
  marketValueBase: number | null;
  unrealizedPnL: number | null;
  unrealizedPnLBase: number | null;
  realizedPnLBase: number | null;
  hasMarketPrice: boolean;
  priceSource: "stored" | "market_data" | "unavailable";
  priceAsOf: string | null;
  marketDataSymbol?: string | null;
};

export type PortfolioSummary = {
  totals: {
    currency: "USD";
    marketValue: number | null;
    costBasis: number | null;
    unrealizedPnL: number | null;
    realizedPnL: number | null;
    assetCount: number;
    openPositionCount: number;
    pricedAssetCount: number;
    unpricedAssetCount: number;
    hasCompleteMarketData: boolean;
  };
};

export type PortfolioPerformancePoint = {
  date: string;
  portfolioValue: number | null;
  costBasis: number | null;
  unrealizedPnL: number | null;
  benchmarkValue: number | null;
  portfolioReturnPct: number | null;
  benchmarkReturnPct: number | null;
};

export type PortfolioPerformance = {
  currency: "USD";
  benchmarkLabel: string;
  points: PortfolioPerformancePoint[];
  coverage: {
    hasPortfolioData: boolean;
    hasBenchmarkData: boolean;
    missingSymbols: string[];
    missingCurrencies: string[];
    marketValuePointCount: number;
    costBasisPointCount: number;
  };
};

export type AssetPayload = {
  symbol: string;
  name: string;
  currency: string;
  currentPrice: number;
};

export type TransactionPayload = {
  assetId: string;
  type: TransactionType;
  quantity: number;
  price: number;
  fee: number;
  occurredAt: string;
  note?: string;
};

type ApiEnvelope<T> = {
  data: T;
};

type ApiFailure = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL?.trim() || "").replace(
  /\/+$/,
  "",
);

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function buildApiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function hasDataEnvelope(payload: unknown): payload is ApiEnvelope<unknown> {
  return typeof payload === "object" && payload !== null && "data" in payload;
}

async function fetchJson(path: string, init?: RequestInit): Promise<{ response: Response; payload: unknown }> {
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(buildApiUrl(path), {
    headers: isFormData
      ? init?.headers
      : {
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
    ...init,
  });

  if (response.status === 204) {
    return { response, payload: undefined };
  }

  const rawPayload = await response.text();

  if (rawPayload.trim().length === 0) {
    throw new ApiError(response.status, "INVALID_RESPONSE", "Server returned an empty response body");
  }

  let payload: unknown;

  try {
    payload = JSON.parse(rawPayload) as ApiEnvelope<unknown> | ApiFailure;
  } catch {
    throw new ApiError(
      response.status,
      "INVALID_RESPONSE",
      "Server returned an invalid JSON response",
      { path: buildApiUrl(path), rawPayload: rawPayload.slice(0, 200) },
    );
  }

  if (!response.ok) {
    const error = (payload as ApiFailure).error;

    if (!error) {
      throw new ApiError(response.status, "HTTP_ERROR", response.statusText || "Request failed", payload);
    }

    throw new ApiError(response.status, error.code, error.message, error.details);
  }

  return { response, payload };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { response, payload } = await fetchJson(path, init);

  if (response.status === 204) {
    return undefined as T;
  }

  if (!hasDataEnvelope(payload)) {
    throw new ApiError(response.status, "INVALID_RESPONSE", "Server response is missing the data field", payload);
  }

  return payload.data as T;
}

async function requestPlain<T>(path: string, init?: RequestInit): Promise<T> {
  const { response, payload } = await fetchJson(path, init);

  if (response.status === 204) {
    return undefined as T;
  }

  return payload as T;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error";
}

export function getHealth(): Promise<{ status: string }> {
  return requestPlain("/health", { method: "GET" });
}

export function getAssets(): Promise<Asset[]> {
  return request("/api/assets", { method: "GET" });
}

export function createAsset(payload: AssetPayload): Promise<Asset> {
  return request("/api/assets", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateAsset(id: string, payload: Partial<AssetPayload>): Promise<Asset> {
  return request(`/api/assets/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteAsset(id: string): Promise<void> {
  return request(`/api/assets/${id}`, {
    method: "DELETE",
  });
}

export function getHoldings(): Promise<Holding[]> {
  return request("/api/portfolio/holdings", { method: "GET" });
}

export function getPortfolioSummary(): Promise<PortfolioSummary> {
  return request("/api/portfolio/summary", { method: "GET" });
}

export function getPortfolioPerformance(): Promise<PortfolioPerformance> {
  return request("/api/portfolio/performance", { method: "GET" });
}

export function getTransactions(filters?: {
  assetId?: string;
  type?: TransactionType | "";
}): Promise<Transaction[]> {
  const params = new URLSearchParams();

  if (filters?.assetId) {
    params.set("assetId", filters.assetId);
  }

  if (filters?.type) {
    params.set("type", filters.type);
  }

  const query = params.toString();
  const path = query ? `/api/transactions?${query}` : "/api/transactions";

  return request(path, { method: "GET" });
}

export function createTransaction(payload: TransactionPayload): Promise<Transaction> {
  return request("/api/transactions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateTransaction(
  id: string,
  payload: Partial<TransactionPayload>,
): Promise<Transaction> {
  return request(`/api/transactions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteTransaction(id: string): Promise<void> {
  return request(`/api/transactions/${id}`, {
    method: "DELETE",
  });
}

export function previewImport(file: File, broker?: Broker): Promise<ImportPreview> {
  const formData = new FormData();
  formData.set("file", file);

  if (broker) {
    formData.set("broker", broker);
  }

  return request("/api/imports/preview", {
    method: "POST",
    body: formData,
  });
}

export function commitImport(payload: {
  broker: Broker;
  items: ImportPreviewItem[];
}): Promise<{
  broker: Broker;
  importedItemCount: number;
  includedItemCount?: number;
  excludedItemCount?: number;
  transactionCount: number;
}> {
  return request("/api/imports/commit", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
