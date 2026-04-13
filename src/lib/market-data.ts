import { AppError } from "./errors";

export type DailyClosePoint = {
  date: string;
  close: number;
};

export type LatestAssetPrice = {
  requestedSymbol: string;
  resolvedSymbol: string | null;
  close: number | null;
  date: string | null;
};

export type MarketDataProvider = {
  getDailySeries(symbol: string, startDate: string, endDate: string): Promise<DailyClosePoint[]>;
  getFxDailySeries(baseCurrency: string, quoteCurrency: string, startDate: string, endDate: string): Promise<DailyClosePoint[]>;
};

type TwelveDataTimeSeriesResponse = {
  status?: string;
  message?: string;
  values?: Array<{
    datetime?: string;
    close?: string;
  }>;
};

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new AppError(503, "MARKET_DATA_UNAVAILABLE", `Missing required environment variable ${name}`);
  }

  return value;
}

function normalizeDate(value: string): string {
  return value.slice(0, 10);
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

const XTB_SYMBOL_EXCHANGE_MAP: Record<string, string[]> = {
  AU: ["ASX"],
  BE: ["BRU"],
  CA: ["TSX"],
  CH: ["SWX"],
  CZ: ["PSE"],
  DE: ["XETRA", "FRA"],
  DK: ["CPH"],
  ES: ["BME"],
  FI: ["HEL"],
  FR: ["EPA"],
  HK: ["HKEX"],
  IT: ["MIL"],
  JP: ["TSE"],
  NL: ["AEX", "AMS"],
  NO: ["OSL"],
  PL: ["GPW"],
  RO: ["BVB"],
  SE: ["STO"],
  SG: ["SGX"],
  UK: ["LSE"],
};

export function buildMarketDataSymbolCandidates(symbol: string): string[] {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const match = normalizedSymbol.match(/^([A-Z0-9-]+)\.([A-Z]{2,4})$/);

  if (!match) {
    return [normalizedSymbol];
  }

  const [, baseSymbol, suffix] = match;

  if (suffix === "US") {
    return uniqueValues([baseSymbol, normalizedSymbol]);
  }

  const exchangeCandidates = (XTB_SYMBOL_EXCHANGE_MAP[suffix] ?? []).map((exchange) => `${baseSymbol}:${exchange}`);

  return uniqueValues([normalizedSymbol, ...exchangeCandidates, baseSymbol]);
}

function parseDailyPoints(payload: TwelveDataTimeSeriesResponse, symbol: string): DailyClosePoint[] {
  if (payload.status === "error") {
    throw new AppError(502, "MARKET_DATA_ERROR", payload.message ?? `Unable to load daily history for ${symbol}`);
  }

  if (!payload.values) {
    return [];
  }

  return payload.values
    .map((point) => {
      const date = point.datetime ? normalizeDate(point.datetime) : null;
      const close = point.close ? Number(point.close) : Number.NaN;

      if (!date || !Number.isFinite(close)) {
        return null;
      }

      return {
        date,
        close,
      };
    })
    .filter((point): point is DailyClosePoint => point !== null)
    .sort((left, right) => left.date.localeCompare(right.date));
}

export async function getFirstAvailableDailySeries(
  provider: MarketDataProvider,
  symbol: string,
  startDate: string,
  endDate: string,
  options?: {
    normalizeAssetSymbol?: boolean;
  },
): Promise<{ resolvedSymbol: string | null; series: DailyClosePoint[] }> {
  const candidates = options?.normalizeAssetSymbol ? buildMarketDataSymbolCandidates(symbol) : [symbol];

  for (const candidate of candidates) {
    try {
      const series = await provider.getDailySeries(candidate, startDate, endDate);

      if (series.length > 0) {
        return {
          resolvedSymbol: candidate,
          series,
        };
      }
    } catch {
      continue;
    }
  }

  return {
    resolvedSymbol: null,
    series: [],
  };
}

export async function getLatestAssetPrice(
  provider: MarketDataProvider,
  symbol: string,
  options?: {
    endDate?: string;
    lookbackDays?: number;
  },
): Promise<LatestAssetPrice> {
  const endDate = options?.endDate ?? new Date().toISOString().slice(0, 10);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const lookbackDays = options?.lookbackDays ?? 30;
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - lookbackDays);
  const startDate = start.toISOString().slice(0, 10);
  const { resolvedSymbol, series } = await getFirstAvailableDailySeries(provider, symbol, startDate, endDate, {
    normalizeAssetSymbol: true,
  });
  const latest = series.at(-1) ?? null;

  return {
    requestedSymbol: symbol,
    resolvedSymbol,
    close: latest?.close ?? null,
    date: latest?.date ?? null,
  };
}

function createTwelveDataProvider(): MarketDataProvider {
  const apiKey = readRequiredEnv("MARKET_DATA_API_KEY");
  const baseUrl = process.env.MARKET_DATA_BASE_URL?.trim() || "https://api.twelvedata.com";

  async function fetchSeries(symbol: string, startDate: string, endDate: string): Promise<DailyClosePoint[]> {
    const url = new URL("/time_series", baseUrl);

    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", "1day");
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);
    url.searchParams.set("order", "ASC");
    url.searchParams.set("timezone", "UTC");
    url.searchParams.set("apikey", apiKey);

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new AppError(
        502,
        "MARKET_DATA_ERROR",
        `Market data request failed for ${symbol} with status ${response.status}`,
      );
    }

    const payload = (await response.json()) as TwelveDataTimeSeriesResponse;

    return parseDailyPoints(payload, symbol);
  }

  return {
    getDailySeries(symbol, startDate, endDate) {
      return fetchSeries(symbol, startDate, endDate);
    },
    getFxDailySeries(baseCurrency, quoteCurrency, startDate, endDate) {
      return fetchSeries(`${baseCurrency}/${quoteCurrency}`, startDate, endDate);
    },
  };
}

export function getMarketDataProvider(): MarketDataProvider {
  const provider = (process.env.MARKET_DATA_PROVIDER ?? "twelvedata").trim().toLowerCase();

  if (provider === "twelvedata") {
    return createTwelveDataProvider();
  }

  throw new AppError(503, "MARKET_DATA_UNAVAILABLE", `Unsupported market data provider "${provider}"`);
}
