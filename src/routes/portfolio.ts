import { Router } from "express";
import { type Asset, type Transaction } from "@prisma/client";

import { inferAssetClassification } from "../lib/asset-classification";
import { AppError, asyncHandler } from "../lib/errors";
import { resolveUsdFxRate } from "../lib/fx-rates";
import { getLatestAssetPrice, getMarketDataProvider, type MarketDataProvider } from "../lib/market-data";
import { buildPortfolioPerformance } from "../lib/performance";
import { calculateLedgerMetrics, roundNumber, toOptionalMarketPrice } from "../lib/portfolio";
import { prisma } from "../lib/prisma";

export const portfolioRouter = Router();

async function loadPortfolioAssets() {
  return prisma.asset.findMany({
    where: {
      portfolioEligible: true,
    },
    include: {
      transactions: {
        orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      },
    },
    orderBy: [{ symbol: "asc" }],
  });
}

type AssetWithTransactions = Asset & {
  transactions: Transaction[];
};

type ResolvedAssetQuote = {
  currentPrice: number | null;
  priceSource: "stored" | "market_data" | "unavailable";
  priceAsOf: string | null;
  marketDataSymbol: string | null;
};

type FxRateMap = Map<string, number | null>;

async function loadMarketDataProviderSafely(): Promise<MarketDataProvider | null> {
  if (process.env.NODE_ENV === "test") {
    return null;
  }

  try {
    return getMarketDataProvider();
  } catch (error) {
    if (
      error instanceof AppError &&
      (error.code === "MARKET_DATA_UNAVAILABLE" || error.code === "MARKET_DATA_ERROR")
    ) {
      return null;
    }

    throw error;
  }
}

async function resolveAssetQuote(
  asset: AssetWithTransactions,
  provider: MarketDataProvider | null,
): Promise<ResolvedAssetQuote> {
  const storedPrice = toOptionalMarketPrice(asset.currentPrice);

  if (storedPrice !== null) {
    return {
      currentPrice: storedPrice,
      priceSource: "stored",
      priceAsOf: asset.updatedAt.toISOString(),
      marketDataSymbol: null,
    };
  }

  if (!provider) {
    return {
      currentPrice: null,
      priceSource: "unavailable",
      priceAsOf: null,
      marketDataSymbol: null,
    };
  }

  try {
    const quote = await getLatestAssetPrice(provider, asset.symbol);

    if (quote.close !== null) {
      return {
        currentPrice: roundNumber(quote.close),
        priceSource: "market_data",
        priceAsOf: quote.date ? `${quote.date}T00:00:00.000Z` : null,
        marketDataSymbol: quote.resolvedSymbol,
      };
    }
  } catch (error) {
    if (
      error instanceof AppError &&
      (error.code === "MARKET_DATA_UNAVAILABLE" || error.code === "MARKET_DATA_ERROR")
    ) {
      return {
        currentPrice: null,
        priceSource: "unavailable",
        priceAsOf: null,
        marketDataSymbol: null,
      };
    }

    throw error;
  }

  return {
    currentPrice: null,
    priceSource: "unavailable",
    priceAsOf: null,
    marketDataSymbol: null,
  };
}

async function loadLatestFxRates(
  assets: AssetWithTransactions[],
  provider: MarketDataProvider | null,
): Promise<FxRateMap> {
  const currencies = [...new Set(assets.map((asset) => asset.currency).filter((currency) => currency !== "USD"))];

  if (currencies.length === 0) {
    return new Map();
  }

  if (!provider) {
    return new Map(currencies.map((currency) => [currency, null] as const));
  }

  const endDate = new Date().toISOString().slice(0, 10);
  const start = new Date(`${endDate}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - 30);
  const startDate = start.toISOString().slice(0, 10);
  const entries = await Promise.all(
    currencies.map(async (currency) => {
      try {
        const series = await provider.getFxDailySeries(currency, "USD", startDate, endDate);
        const latest = series.at(-1)?.close ?? null;

        return [currency, latest] as const;
      } catch {
        return [currency, null] as const;
      }
    }),
  );

  return new Map(entries);
}

function toBaseValue(value: number | null, currency: string, fxRates: FxRateMap): number | null {
  if (value === null) {
    return null;
  }

  const fxRate = resolveUsdFxRate(currency, fxRates.get(currency) ?? null);

  if (fxRate === null) {
    return null;
  }

  return roundNumber(value * fxRate);
}

function sumPresent(values: Array<number | null>): number | null {
  const presentValues = values.filter((value): value is number => value !== null);

  if (presentValues.length === 0) {
    return null;
  }

  return roundNumber(presentValues.reduce((total, value) => total + value, 0));
}

async function buildHoldings() {
  const assets = await loadPortfolioAssets();
  const provider = await loadMarketDataProviderSafely();
  const [quotes, fxRates] = await Promise.all([
    Promise.all(assets.map(async (asset) => [asset.id, await resolveAssetQuote(asset, provider)] as const)),
    loadLatestFxRates(assets, provider),
  ]);
  const quoteMap = new Map(quotes);

  return assets
    .map((asset) => {
      const quote = quoteMap.get(asset.id) ?? {
        currentPrice: null,
        priceSource: "unavailable" as const,
        priceAsOf: null,
        marketDataSymbol: null,
      };
      const metrics = calculateLedgerMetrics(asset.transactions, quote.currentPrice);
      const classification = inferAssetClassification(asset);
      const fxRateToBase = resolveUsdFxRate(asset.currency, fxRates.get(asset.currency) ?? null);
      const marketValueBase = toBaseValue(metrics.marketValue, asset.currency, fxRates);
      const costBasisBase = toBaseValue(metrics.costBasis, asset.currency, fxRates);
      const realizedPnLBase = toBaseValue(metrics.realizedPnL, asset.currency, fxRates);
      const unrealizedPnLBase =
        marketValueBase !== null && costBasisBase !== null ? roundNumber(marketValueBase - costBasisBase) : null;

      return {
        assetId: asset.id,
        symbol: asset.symbol,
        name: asset.name,
        currency: asset.currency,
        assetClass: asset.assetClass,
        sector: classification.sector,
        region: classification.region,
        continent: classification.continent,
        baseCurrency: "USD" as const,
        fxRateToBase,
        costBasisBase,
        marketValueBase,
        unrealizedPnLBase,
        realizedPnLBase,
        priceSource: quote.priceSource,
        priceAsOf: quote.priceAsOf,
        marketDataSymbol: quote.marketDataSymbol,
        ...metrics,
      };
    })
    .filter((holding) => holding.quantity > 0);
}

portfolioRouter.get(
  ["/holdings", "/open-positions"],
  asyncHandler(async (_req, res) => {
    const holdings = await buildHoldings();

    res.json({ data: holdings });
  }),
);

portfolioRouter.get(
  "/summary",
  asyncHandler(async (_req, res) => {
    const holdings = await buildHoldings();
    const pricedAssetCount = holdings.filter((holding) => holding.marketValueBase !== null).length;
    const unpricedAssetCount = holdings.length - pricedAssetCount;
    const hasCompleteMarketData = holdings.every(
      (holding) => holding.marketValueBase !== null && holding.unrealizedPnLBase !== null,
    );

    res.json({
      data: {
        totals: {
          currency: "USD",
          marketValue: holdings.length === 0 ? 0 : sumPresent(holdings.map((holding) => holding.marketValueBase)),
          costBasis: holdings.length === 0 ? 0 : sumPresent(holdings.map((holding) => holding.costBasisBase)),
          unrealizedPnL:
            holdings.length === 0 ? 0 : sumPresent(holdings.map((holding) => holding.unrealizedPnLBase)),
          realizedPnL: holdings.length === 0 ? 0 : sumPresent(holdings.map((holding) => holding.realizedPnLBase)),
          assetCount: holdings.length,
          openPositionCount: holdings.length,
          pricedAssetCount,
          unpricedAssetCount,
          hasCompleteMarketData: holdings.length === 0 ? true : hasCompleteMarketData,
        },
      },
    });
  }),
);

portfolioRouter.get(
  "/performance",
  asyncHandler(async (_req, res) => {
    const assets = await loadPortfolioAssets();

    const benchmarkLabel = process.env.MARKET_DATA_BENCHMARK_LABEL?.trim() || "S&P 500";
    let performance;

    try {
      const provider = await loadMarketDataProviderSafely();

      performance = await buildPortfolioPerformance({
        assets,
        provider,
        benchmarkSymbol: process.env.MARKET_DATA_BENCHMARK_SYMBOL?.trim() || "SPY",
        benchmarkLabel,
      });
    } catch (error) {
      if (
        error instanceof AppError &&
        (error.code === "MARKET_DATA_UNAVAILABLE" || error.code === "MARKET_DATA_ERROR")
      ) {
        performance = {
          currency: "USD" as const,
          benchmarkLabel,
          points: [],
          coverage: {
            hasPortfolioData: false,
            hasBenchmarkData: false,
            missingSymbols: [],
            missingCurrencies: [],
            marketValuePointCount: 0,
            costBasisPointCount: 0,
          },
        };
      } else {
        throw error;
      }
    }

    res.json({ data: performance });
  }),
);
