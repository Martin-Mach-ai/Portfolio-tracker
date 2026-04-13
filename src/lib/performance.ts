import { type Asset, type Transaction, TransactionType } from "@prisma/client";

import { resolveUsdFxRate } from "./fx-rates";
import { getFirstAvailableDailySeries, type DailyClosePoint, type MarketDataProvider } from "./market-data";
import { roundNumber, sortLedgerTransactions, toNumber } from "./portfolio";

type AssetWithTransactions = Asset & {
  transactions: Transaction[];
};

type Coverage = {
  hasPortfolioData: boolean;
  hasBenchmarkData: boolean;
  missingSymbols: string[];
  missingCurrencies: string[];
  marketValuePointCount: number;
  costBasisPointCount: number;
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

export type PortfolioPerformanceResponse = {
  currency: "USD";
  benchmarkLabel: string;
  points: PortfolioPerformancePoint[];
  coverage: Coverage;
};

type ResolvedSeries = {
  byDate: Map<string, number>;
  dates: string[];
};

type LedgerState = {
  quantity: number;
  costBasis: number;
};

function toUtcDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function buildSeries(points: DailyClosePoint[]): ResolvedSeries {
  return {
    byDate: new Map(points.map((point) => [point.date, point.close])),
    dates: points.map((point) => point.date),
  };
}

function findValueOnOrBefore(series: ResolvedSeries, date: string): number | null {
  for (let index = series.dates.length - 1; index >= 0; index -= 1) {
    const candidateDate = series.dates[index];

    if (candidateDate && candidateDate <= date) {
      return series.byDate.get(candidateDate) ?? null;
    }
  }

  return null;
}

function listDailyRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

async function loadAssetPriceSeries(
  assets: AssetWithTransactions[],
  provider: MarketDataProvider | null,
  startDate: string,
  endDate: string,
) {
  if (!provider) {
    return new Map<string, ResolvedSeries>();
  }

  const uniqueSymbols = [...new Set(assets.map((asset) => asset.symbol))];
  const seriesEntries = await Promise.all(
    uniqueSymbols.map(async (symbol) => {
      const resolved = await getFirstAvailableDailySeries(provider, symbol, startDate, endDate, {
        normalizeAssetSymbol: true,
      });

      return [symbol, buildSeries(resolved.series)] as const;
    }),
  );

  return new Map(seriesEntries);
}

async function loadFxSeries(
  assets: AssetWithTransactions[],
  provider: MarketDataProvider | null,
  startDate: string,
  endDate: string,
) {
  if (!provider) {
    return new Map<string, ResolvedSeries>();
  }

  const currencies = [...new Set(assets.map((asset) => asset.currency).filter((currency) => currency !== "USD"))];
  const seriesEntries = await Promise.all(
    currencies.map(async (currency) => {
      try {
        return [
          currency,
          buildSeries(await provider.getFxDailySeries(currency, "USD", startDate, endDate)),
        ] as const;
      } catch {
        return [currency, buildSeries([])] as const;
      }
    }),
  );

  return new Map(seriesEntries);
}

function buildLedgerTimeline(asset: AssetWithTransactions): Map<string, LedgerState> {
  const timeline = new Map<string, LedgerState>();
  let quantityHeld = 0;
  let costBasis = 0;

  for (const transaction of sortLedgerTransactions(asset.transactions)) {
    const quantity = toNumber(transaction.quantity);
    const price = toNumber(transaction.price);
    const fee = toNumber(transaction.fee);

    if (transaction.type === TransactionType.BUY) {
      quantityHeld += quantity;
      costBasis += quantity * price + fee;
    } else if (quantityHeld > 0) {
      const averageCost = costBasis / quantityHeld;
      costBasis -= averageCost * quantity;
      quantityHeld -= quantity;

      if (quantityHeld < 1e-8) {
        quantityHeld = 0;
        costBasis = 0;
      }
    }

    timeline.set(toUtcDateKey(transaction.occurredAt), {
      quantity: roundNumber(quantityHeld),
      costBasis: roundNumber(costBasis),
    });
  }

  return timeline;
}

function findLedgerStateOnOrBefore(timeline: Map<string, LedgerState>, dates: string[], date: string): LedgerState {
  let state: LedgerState = { quantity: 0, costBasis: 0 };

  for (const candidate of dates) {
    if (candidate > date) {
      break;
    }

    state = timeline.get(candidate) ?? state;
  }

  return state;
}

function emptyCoverage(hasBenchmarkData = false): Coverage {
  return {
    hasPortfolioData: false,
    hasBenchmarkData,
    missingSymbols: [],
    missingCurrencies: [],
    marketValuePointCount: 0,
    costBasisPointCount: 0,
  };
}

export async function buildPortfolioPerformance(options: {
  assets: AssetWithTransactions[];
  provider: MarketDataProvider | null;
  benchmarkSymbol: string;
  benchmarkLabel?: string;
}): Promise<PortfolioPerformanceResponse> {
  const assets = options.assets.filter((asset) => asset.transactions.length > 0);

  if (assets.length === 0) {
    return {
      currency: "USD",
      benchmarkLabel: options.benchmarkLabel ?? "S&P 500",
      points: [],
      coverage: emptyCoverage(),
    };
  }

  const allTransactions = assets.flatMap((asset) => asset.transactions);
  const sortedTransactions = sortLedgerTransactions(allTransactions);
  const startDate = toUtcDateKey(sortedTransactions[0]!.occurredAt);
  const endDate = new Date().toISOString().slice(0, 10);
  const [assetSeriesMap, fxSeriesMap, benchmarkSeries] = await Promise.all([
    loadAssetPriceSeries(assets, options.provider, startDate, endDate),
    loadFxSeries(assets, options.provider, startDate, endDate),
    options.provider ? options.provider.getDailySeries(options.benchmarkSymbol, startDate, endDate).catch(() => []) : [],
  ]);

  const benchmarkResolved = buildSeries(benchmarkSeries);
  const quantityTimelines = new Map(assets.map((asset) => [asset.id, buildLedgerTimeline(asset)] as const));
  const quantityDatesByAsset = new Map(
    assets.map((asset) => [asset.id, [...quantityTimelines.get(asset.id)!.keys()].sort()] as const),
  );
  const allDates = listDailyRange(startDate, endDate);
  const missingSymbols = new Set<string>();
  const missingCurrencies = new Set<string>();

  const rawPoints = allDates.map((date) => {
    let portfolioValue = 0;
    let costBasis = 0;
    let hasOpenPositions = false;
    let hasAnyCostBasis = false;
    let hasAnyMarketValue = false;

    for (const asset of assets) {
      const ledgerTimeline = quantityTimelines.get(asset.id)!;
      const quantityDates = quantityDatesByAsset.get(asset.id)!;
      const state = findLedgerStateOnOrBefore(ledgerTimeline, quantityDates, date);

      if (state.quantity <= 0) {
        continue;
      }

      hasOpenPositions = true;

      let usdFxRate = 1;

      if (asset.currency !== "USD") {
        const fxSeries = fxSeriesMap.get(asset.currency);
        const fxClose = fxSeries ? findValueOnOrBefore(fxSeries, date) : null;
        const resolvedFxRate = resolveUsdFxRate(asset.currency, fxClose);

        if (resolvedFxRate === null) {
          missingCurrencies.add(asset.currency);
          continue;
        }

        usdFxRate = resolvedFxRate;
      }

      costBasis += state.costBasis * usdFxRate;
      hasAnyCostBasis = true;

      const assetSeries = assetSeriesMap.get(asset.symbol);
      const close = assetSeries ? findValueOnOrBefore(assetSeries, date) : null;

      if (close === null) {
        missingSymbols.add(asset.symbol);
        continue;
      }

      portfolioValue += state.quantity * close * usdFxRate;
      hasAnyMarketValue = true;
    }

    const benchmarkClose = findValueOnOrBefore(benchmarkResolved, date);
    const resolvedCostBasis = !hasOpenPositions ? 0 : hasAnyCostBasis ? roundNumber(costBasis) : null;
    const resolvedPortfolioValue = !hasOpenPositions ? 0 : hasAnyMarketValue ? roundNumber(portfolioValue) : null;

    return {
      date,
      costBasis: resolvedCostBasis,
      portfolioValue: resolvedPortfolioValue,
      benchmarkClose,
    };
  });

  const firstPortfolioValuePoint = rawPoints.find((point) => point.portfolioValue !== null && point.portfolioValue > 0);
  const firstBenchmarkPoint = rawPoints.find(
    (point) => point.portfolioValue !== null && point.portfolioValue > 0 && point.benchmarkClose !== null,
  );
  const basePoint = firstBenchmarkPoint ?? firstPortfolioValuePoint ?? null;
  const basePortfolioValue = basePoint?.portfolioValue ?? null;
  const baseBenchmarkClose = basePoint?.benchmarkClose ?? null;

  const points = rawPoints.map((point) => {
    const portfolioReturnPct =
      basePortfolioValue !== null && point.portfolioValue !== null && basePortfolioValue > 0
        ? roundNumber(((point.portfolioValue / basePortfolioValue) - 1) * 100)
        : null;
    const benchmarkValue =
      baseBenchmarkClose !== null && basePortfolioValue !== null && point.benchmarkClose !== null
        ? roundNumber((point.benchmarkClose / baseBenchmarkClose) * basePortfolioValue)
        : null;
    const benchmarkReturnPct =
      baseBenchmarkClose !== null && point.benchmarkClose !== null
        ? roundNumber(((point.benchmarkClose / baseBenchmarkClose) - 1) * 100)
        : null;
    const unrealizedPnL =
      point.portfolioValue !== null && point.costBasis !== null
        ? roundNumber(point.portfolioValue - point.costBasis)
        : null;

    return {
      date: point.date,
      portfolioValue: point.portfolioValue,
      costBasis: point.costBasis,
      unrealizedPnL,
      benchmarkValue,
      portfolioReturnPct,
      benchmarkReturnPct,
    };
  });

  const marketValuePointCount = points.filter((point) => point.portfolioValue !== null).length;
  const costBasisPointCount = points.filter((point) => point.costBasis !== null).length;

  return {
    currency: "USD",
    benchmarkLabel: options.benchmarkLabel ?? "S&P 500",
    points,
    coverage: {
      hasPortfolioData: marketValuePointCount > 0 || costBasisPointCount > 0,
      hasBenchmarkData: benchmarkSeries.length > 0,
      missingSymbols: [...missingSymbols].sort(),
      missingCurrencies: [...missingCurrencies].sort(),
      marketValuePointCount,
      costBasisPointCount,
    },
  };
}
