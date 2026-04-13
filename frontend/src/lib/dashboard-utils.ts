import type { Holding, PortfolioPerformance } from "./api";

export type DashboardSummary = {
  baseCurrency: string;
  marketValue: number | null;
  costBasis: number | null;
  unrealizedPnL: number | null;
  realizedPnL: number | null;
  openPositionCount: number;
  unpricedAssetCount: number;
  pricedAssetCount: number;
  hasCompleteMarketData: boolean;
};

export type AllocationSlice = {
  label: string;
  value: number;
  percentage: number;
  holdingCount: number;
};

export type AllocationBreakdown = {
  total: number;
  includedHoldings: number;
  excludedHoldings: number;
  fallbackToCostBasis: boolean;
  costBasisHoldings: number;
  items: AllocationSlice[];
};

export type TopHolding = {
  assetId: string;
  symbol: string;
  name: string;
  sector: string;
  currency: string;
  value: number;
  percentage: number;
  valueSource: "marketValue" | "costBasis";
};

const UNKNOWN_SECTOR_LABEL = "Neznámý sektor";
const UNKNOWN_CURRENCY_LABEL = "Neznámá měna";
const UNKNOWN_REGION_LABEL = "Neznámý region";
const USD_BASE_FALLBACK_RATES: Record<string, number> = {
  CHF: 1.13,
  CZK: 0.043,
  EUR: 1.09,
  GBP: 1.28,
  GBX: 0.0128,
  PLN: 0.25,
};

function roundValue(value: number): number {
  return Number(value.toFixed(6));
}

function sumNullable(values: Array<number | null>): number | null {
  if (values.some((value) => value === null)) {
    return null;
  }

  return roundValue(values.reduce<number>((total, value) => total + (value ?? 0), 0));
}

function sumPresent(values: Array<number | null>): number | null {
  const presentValues = values.filter((value): value is number => value !== null);

  if (presentValues.length === 0) {
    return null;
  }

  return roundValue(presentValues.reduce<number>((total, value) => total + value, 0));
}

function normalizeLabel(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeCurrencyLabel(value: string | null | undefined): string {
  const normalized = value?.trim().toUpperCase();
  return normalized && normalized.length > 0 ? normalized : UNKNOWN_CURRENCY_LABEL;
}

function normalizeMetadataLabel(
  primaryValue: string | null | undefined,
  fallbackValue: string | null | undefined,
  unknownLabel: string,
): string {
  for (const candidate of [primaryValue, fallbackValue]) {
    const normalized = candidate?.trim();

    if (!normalized || normalized.length === 0) {
      continue;
    }

    if (normalized === "Neznámé") {
      continue;
    }

    return normalized;
  }

  return unknownLabel;
}

function inferFxRateToBase(holding: Holding): number | null {
  const directRate = finiteOrNull(holding.fxRateToBase);

  if (directRate !== null && directRate > 0) {
    return directRate;
  }

  const marketValue = finiteOrNull(holding.marketValue);
  const marketValueBase = finiteOrNull(holding.marketValueBase);

  if (marketValue !== null && marketValue !== 0 && marketValueBase !== null) {
    return roundValue(marketValueBase / marketValue);
  }

  const costBasis = finiteOrNull(holding.costBasis);
  const costBasisBase = finiteOrNull(holding.costBasisBase);

  if (costBasis !== null && costBasis !== 0 && costBasisBase !== null) {
    return roundValue(costBasisBase / costBasis);
  }

  const normalizedCurrency = normalizeCurrencyLabel(holding.currency);

  if (normalizedCurrency === "USD") {
    return 1;
  }

  const fallbackRate = USD_BASE_FALLBACK_RATES[normalizedCurrency];
  return typeof fallbackRate === "number" ? roundValue(fallbackRate) : null;
}

function resolveBaseValue(nativeValue: number | null, baseValue: number | null, fxRateToBase: number | null): number | null {
  if (baseValue !== null) {
    return baseValue;
  }

  if (nativeValue === null || fxRateToBase === null) {
    return null;
  }

  return roundValue(nativeValue * fxRateToBase);
}

function inferClassification(holding: Holding): Pick<Holding, "sector" | "region" | "continent"> {
  const symbol = holding.symbol.toUpperCase();
  const name = holding.name.toUpperCase();

  if (symbol.includes("BTC") || symbol.includes("ETH") || holding.assetClass === "CRYPTO" || holding.assetClass === "FOREX") {
    return { sector: "Ostatní", region: "Globální", continent: "Ostatní" };
  }

  if (/\b(BANK|FINANC|VISA|MASTERCARD|JPM)\b/.test(name) || /\b(JPM|V)\b/.test(symbol)) {
    return {
      sector: "Finance",
      region: holding.currency === "USD" ? "Severní Amerika" : "Neznámé",
      continent: holding.currency === "USD" ? "Severní Amerika" : "Neznámé",
    };
  }

  if (/\b(TECH|SOFT|CHIP|APPLE|MICROSOFT|ALPHABET|META|SAP)\b/.test(name) || /\b(AAPL|MSFT|NVDA|GOOG|GOOGL|SAP)\b/.test(symbol)) {
    return {
      sector: "Technologie",
      region: holding.currency === "USD" ? "Severní Amerika" : "Evropa",
      continent: holding.currency === "USD" ? "Severní Amerika" : "Evropa",
    };
  }

  if (/\b(OIL|GAS|ENERGY|SHELL|CHEVRON|EXXON|CEZ)\b/.test(name) || /\b(CEZ|SHEL)\b/.test(symbol)) {
    return {
      sector: "Energie",
      region: holding.currency === "USD" ? "Severní Amerika" : "Evropa",
      continent: holding.currency === "USD" ? "Severní Amerika" : "Evropa",
    };
  }

  const europeCurrencies = new Set(["CZK", "EUR", "GBP", "CHF", "PLN"]);
  const normalizedCurrency = normalizeCurrencyLabel(holding.currency);
  const region = europeCurrencies.has(normalizedCurrency)
    ? "Evropa"
    : normalizedCurrency === "USD"
      ? "Severní Amerika"
      : "Neznámé";

  return {
    sector: holding.assetClass === "ETF" ? "Ostatní" : "Neznámé",
    region,
    continent: region,
  };
}

function resolveHoldingBaseMetrics(holding: Holding) {
  const fxRateToBase = inferFxRateToBase(holding);
  const marketValueBase = resolveBaseValue(
    finiteOrNull(holding.marketValue),
    finiteOrNull(holding.marketValueBase),
    fxRateToBase,
  );
  const costBasisBase = resolveBaseValue(
    finiteOrNull(holding.costBasis),
    finiteOrNull(holding.costBasisBase),
    fxRateToBase,
  );

  return {
    fxRateToBase,
    marketValueBase,
    costBasisBase,
    resolvedValue: marketValueBase ?? costBasisBase,
    valueSource: marketValueBase !== null ? "marketValue" as const : costBasisBase !== null ? "costBasis" as const : null,
  };
}

export function buildDashboardSummary(holdings: Holding[]): DashboardSummary {
  const pricedAssetCount = holdings.filter((holding) => holding.marketValueBase !== null).length;

  return {
    baseCurrency: holdings[0]?.baseCurrency ?? "USD",
    marketValue: holdings.length === 0 ? 0 : sumPresent(holdings.map((holding) => holding.marketValueBase)),
    costBasis: holdings.length === 0 ? 0 : sumPresent(holdings.map((holding) => holding.costBasisBase)),
    unrealizedPnL: holdings.length === 0 ? 0 : sumPresent(holdings.map((holding) => holding.unrealizedPnLBase)),
    realizedPnL: holdings.length === 0 ? 0 : sumPresent(holdings.map((holding) => holding.realizedPnLBase)),
    openPositionCount: holdings.length,
    pricedAssetCount,
    unpricedAssetCount: holdings.length - pricedAssetCount,
    hasCompleteMarketData: holdings.every((holding) => holding.marketValueBase !== null && holding.unrealizedPnLBase !== null),
  };
}

export function buildAllocationBreakdown(
  holdings: Holding[],
  getLabel: (holding: Holding) => string,
  fallbackLabel: string,
): AllocationBreakdown {
  const resolvedHoldings = holdings
    .map((holding) => ({
      holding,
      metrics: resolveHoldingBaseMetrics(holding),
    }))
    .filter((entry) => entry.metrics.resolvedValue !== null);
  const total = resolvedHoldings.reduce((sum, entry) => sum + (entry.metrics.resolvedValue ?? 0), 0);
  const buckets = new Map<string, { value: number; holdingCount: number }>();

  for (const entry of resolvedHoldings) {
    const label = normalizeLabel(getLabel(entry.holding), fallbackLabel);
    const current = buckets.get(label) ?? { value: 0, holdingCount: 0 };
    current.value += entry.metrics.resolvedValue ?? 0;
    current.holdingCount += 1;
    buckets.set(label, current);
  }

  const items = [...buckets.entries()]
    .map(([label, bucket]) => ({
      label,
      value: roundValue(bucket.value),
      percentage: total > 0 ? roundValue((bucket.value / total) * 100) : 0,
      holdingCount: bucket.holdingCount,
    }))
    .sort((left, right) => right.value - left.value);

  return {
    total: roundValue(total),
    includedHoldings: resolvedHoldings.length,
    excludedHoldings: holdings.length - resolvedHoldings.length,
    fallbackToCostBasis: resolvedHoldings.length > 0 && resolvedHoldings.every((entry) => entry.metrics.valueSource === "costBasis"),
    costBasisHoldings: resolvedHoldings.filter((entry) => entry.metrics.valueSource === "costBasis").length,
    items,
  };
}

export function buildTopHoldings(holdings: Holding[], limit = 5): TopHolding[] {
  const rankedHoldings = holdings
    .map((holding) => ({
      holding,
      metrics: resolveHoldingBaseMetrics(holding),
    }))
    .filter((entry) => entry.metrics.resolvedValue !== null)
    .sort((left, right) => (right.metrics.resolvedValue ?? 0) - (left.metrics.resolvedValue ?? 0));
  const total = rankedHoldings.reduce((sum, entry) => sum + (entry.metrics.resolvedValue ?? 0), 0);

  return rankedHoldings.slice(0, limit).map(({ holding, metrics }) => ({
    assetId: holding.assetId,
    symbol: holding.symbol,
    name: holding.name,
    sector: holding.sector,
    currency: holding.currency,
    value: roundValue(metrics.resolvedValue ?? 0),
    percentage: total > 0 ? roundValue(((metrics.resolvedValue ?? 0) / total) * 100) : 0,
    valueSource: metrics.valueSource ?? "costBasis",
  }));
}

export function getHistoryCoverageLabel(performance: PortfolioPerformance): string {
  const { marketValuePointCount, costBasisPointCount } = performance.coverage;

  if (marketValuePointCount === 0 && costBasisPointCount === 0) {
    return "Data nejsou zatím dostupná";
  }

  if (marketValuePointCount === performance.points.length) {
    return "Kompletní historie";
  }

  if (marketValuePointCount === 0 && costBasisPointCount > 0) {
    return "Pouze cost basis";
  }

  return "Částečná market value historie";
}

export function normalizeDashboardHoldings(holdings: Holding[]): Holding[] {
  return holdings.map((holding) => {
    const fallbackClassification = inferClassification(holding);
    const { fxRateToBase, marketValueBase, costBasisBase } = resolveHoldingBaseMetrics(holding);
    const unrealizedPnLBase =
      finiteOrNull(holding.unrealizedPnLBase) ??
      (marketValueBase !== null && costBasisBase !== null ? roundValue(marketValueBase - costBasisBase) : null);

    return {
      ...holding,
      currency: normalizeCurrencyLabel(holding.currency),
      sector: normalizeMetadataLabel(holding.sector, fallbackClassification.sector, UNKNOWN_SECTOR_LABEL),
      region: normalizeMetadataLabel(holding.region, fallbackClassification.region, UNKNOWN_REGION_LABEL),
      continent: normalizeMetadataLabel(holding.continent, fallbackClassification.continent, UNKNOWN_REGION_LABEL),
      baseCurrency: holding.baseCurrency || "USD",
      fxRateToBase,
      marketValueBase,
      costBasisBase,
      unrealizedPnLBase,
      realizedPnLBase: finiteOrNull(holding.realizedPnLBase),
    };
  });
}

export function normalizePortfolioPerformance(performance: PortfolioPerformance): PortfolioPerformance {
  const points = performance.points.map((point) => ({
    ...point,
    portfolioValue: finiteOrNull(point.portfolioValue),
    costBasis: finiteOrNull(point.costBasis),
    unrealizedPnL: finiteOrNull(point.unrealizedPnL),
    benchmarkValue: finiteOrNull(point.benchmarkValue),
    portfolioReturnPct: finiteOrNull(point.portfolioReturnPct),
    benchmarkReturnPct: finiteOrNull(point.benchmarkReturnPct),
  }));

  return {
    ...performance,
    points,
    coverage: {
      ...performance.coverage,
      marketValuePointCount:
        typeof performance.coverage.marketValuePointCount === "number"
          ? performance.coverage.marketValuePointCount
          : points.filter((point) => point.portfolioValue !== null).length,
      costBasisPointCount:
        typeof performance.coverage.costBasisPointCount === "number"
          ? performance.coverage.costBasisPointCount
          : points.filter((point) => point.costBasis !== null).length,
    },
  };
}
