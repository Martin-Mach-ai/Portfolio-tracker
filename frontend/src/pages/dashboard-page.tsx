import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { getErrorMessage, getHoldings, getPortfolioPerformance, type Holding, type PortfolioPerformance } from "../lib/api";
import {
  buildAllocationBreakdown,
  buildDashboardSummary,
  buildTopHoldings,
  normalizeDashboardHoldings,
  normalizePortfolioPerformance,
} from "../lib/dashboard-utils";
import { formatDateTime, formatNumber, formatOptionalCurrency, formatOptionalPnL } from "../lib/format";
import { t } from "../lib/i18n";
import {
  applySortDirection,
  compareNumber,
  compareText,
  getUniqueOptions,
  matchesSearch,
  type SortDirection,
} from "../lib/table-utils";
import { AllocationDonutChart } from "../components/allocation-donut-chart";
import { DataQualityPanel } from "../components/data-quality-panel";
import { PortfolioHistoryChart } from "../components/portfolio-history-chart";
import { SummaryCards } from "../components/summary-cards";
import { TableToolbar } from "../components/table-toolbar";
import { TopHoldingsChart } from "../components/top-holdings-chart";

type HoldingsSortKey = "symbol" | "marketValue" | "unrealizedPnL" | "quantity";

function sortHoldings(left: Holding, right: Holding, sortBy: HoldingsSortKey, sortDirection: SortDirection) {
  const leftValue = left.marketValueBase ?? left.costBasisBase;
  const rightValue = right.marketValueBase ?? right.costBasisBase;
  const leftPnl = left.unrealizedPnLBase ?? left.realizedPnLBase;
  const rightPnl = right.unrealizedPnLBase ?? right.realizedPnLBase;

  switch (sortBy) {
    case "marketValue":
      return compareNumber(leftValue, rightValue, sortDirection);
    case "unrealizedPnL":
      return compareNumber(leftPnl, rightPnl, sortDirection);
    case "quantity":
      return compareNumber(left.quantity, right.quantity, sortDirection);
    case "symbol":
    default:
      return applySortDirection(compareText(left.symbol, right.symbol), sortDirection);
  }
}

function createFallbackPerformance(): PortfolioPerformance {
  return {
    currency: "USD",
    benchmarkLabel: "S&P 500",
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
}

export function DashboardPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [currencyFilter, setCurrencyFilter] = useState("");
  const [assetClassFilter, setAssetClassFilter] = useState("");
  const [sortBy, setSortBy] = useState<HoldingsSortKey>("marketValue");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const holdingsQuery = useQuery({
    queryKey: ["holdings"],
    queryFn: getHoldings,
  });
  const performanceQuery = useQuery({
    queryKey: ["performance"],
    queryFn: getPortfolioPerformance,
    retry: false,
  });

  if (holdingsQuery.isPending || performanceQuery.isPending) {
    return (
      <section className="panel">
        <div className="panel__header">
          <div className="panel__header-copy">
            <span className="panel__eyebrow">{t.dashboard.eyebrow}</span>
            <h2>{t.dashboard.title}</h2>
          </div>
        </div>
        <div className="loading-grid">
          <div className="loading-card" />
          <div className="loading-card" />
          <div className="loading-card" />
          <div className="loading-card" />
          <div className="loading-card loading-card--wide" />
          <div className="loading-card loading-card--wide" />
        </div>
      </section>
    );
  }

  if (holdingsQuery.isError) {
    return (
      <section className="panel">
        <div className="panel__header">
          <div className="panel__header-copy">
            <span className="panel__eyebrow">{t.dashboard.eyebrow}</span>
            <h2>{t.dashboard.title}</h2>
          </div>
        </div>
        <div className="empty-state empty-state--error">
          <h3>{t.dashboard.loadingErrorTitle}</h3>
          <p>{getErrorMessage(holdingsQuery.error)}</p>
        </div>
      </section>
    );
  }

  const holdings = normalizeDashboardHoldings(holdingsQuery.data);
  const performance = performanceQuery.isError ? createFallbackPerformance() : normalizePortfolioPerformance(performanceQuery.data);
  const summary = buildDashboardSummary(holdings);
  const sectorBreakdown = buildAllocationBreakdown(holdings, (holding) => holding.sector, "Neznámý sektor");
  const currencyBreakdown = buildAllocationBreakdown(holdings, (holding) => holding.currency, "Neznámá měna");
  const regionBreakdown = buildAllocationBreakdown(holdings, (holding) => holding.continent || holding.region, "Neznámý region");
  const topHoldings = buildTopHoldings(holdings, 5);
  const currencyOptions = getUniqueOptions(holdings.map((holding) => holding.currency));
  const assetClassOptions = getUniqueOptions(holdings.map((holding) => holding.assetClass));
  const filteredHoldings = [...holdings]
    .filter((holding) => matchesSearch(searchQuery, holding.symbol, holding.name))
    .filter((holding) => (currencyFilter ? holding.currency === currencyFilter : true))
    .filter((holding) => (assetClassFilter ? holding.assetClass === assetClassFilter : true))
    .sort((left, right) => sortHoldings(left, right, sortBy, sortDirection));

  return (
    <div className="page-stack">
      <section className="panel panel--hero">
        <div className="panel__header panel__header--hero">
          <div className="panel__header-copy">
            <span className="panel__eyebrow">{t.dashboard.eyebrow}</span>
            <h2>{t.dashboard.title}</h2>
            <p className="panel__copy">{t.dashboard.description}</p>
          </div>
          <div className="dashboard-hero__meta">
            <span className="dashboard-chip">Base currency: {summary.baseCurrency}</span>
            <span className="dashboard-chip">Open positions: {summary.openPositionCount}</span>
            <span className="dashboard-chip">Priced: {summary.pricedAssetCount}</span>
          </div>
        </div>
        <SummaryCards summary={summary} />
        {!summary.hasCompleteMarketData && summary.openPositionCount > 0 ? (
          <div className="form-message form-message--warning">
            <p>{t.dashboard.marketDataWarning}</p>
          </div>
        ) : null}
      </section>

      <section className="dashboard-split-grid">
        <section className="panel">
          <div className="panel__header">
            <div className="panel__header-copy">
              <span className="panel__eyebrow">Historie</span>
              <h2>Vývoj portfolia v čase</h2>
            </div>
            <p className="panel__copy">Časová osa ukazuje skutečnou historii portfolia. Když chybí ceny, průběh drží alespoň ledgerový cost basis.</p>
          </div>
          {performanceQuery.isError ? (
            <div className="form-message form-message--warning">
              <p>{getErrorMessage(performanceQuery.error)}</p>
            </div>
          ) : null}
          <PortfolioHistoryChart performance={performance} />
        </section>

        <section className="panel panel--top-holdings">
          <div className="panel__header">
            <div className="panel__header-copy">
              <span className="panel__eyebrow">Koncentrace</span>
              <h2>Největší pozice</h2>
            </div>
            <p className="panel__copy">Top 5 holdings podle market value, s automatickým fallbackem na cost basis tam, kde cena chybí.</p>
          </div>
          <TopHoldingsChart holdings={topHoldings} currency={summary.baseCurrency} />
        </section>
      </section>

      <section className="dashboard-grid dashboard-grid--allocations">
        <AllocationDonutChart
          title="Rozložení podle sektorů"
          description="Podíl portfolia podle sektoru. Když chybí live cena, použije se cost basis."
          breakdown={sectorBreakdown}
          currency={summary.baseCurrency}
          emptyTitle="Sektorové rozložení zatím není dostupné"
          emptyDescription="Chybí použitelná hodnota pozic, takže graf zatím nejde spočítat."
        />
        <AllocationDonutChart
          title="Rozložení podle měn"
          description="Měnová expozice všech pozic, které mají použitelnou base hodnotu."
          breakdown={currencyBreakdown}
          currency={summary.baseCurrency}
          emptyTitle="Měnový breakdown zatím není dostupný"
          emptyDescription="Pro porovnání měn chybí použitelný přepočet do base currency."
        />
        <AllocationDonutChart
          title="Rozložení podle regionu"
          description="Region z metadata aktiva, jinak z bezpečného fallbacku podle symbolu nebo měny."
          breakdown={regionBreakdown}
          currency={summary.baseCurrency}
          emptyTitle="Regionální rozložení zatím není dostupné"
          emptyDescription="Pro regionální breakdown zatím chybí dost použitelných hodnot."
        />
      </section>

      <DataQualityPanel holdings={holdings} performance={performance} />

      <section className="panel">
        <div className="panel__header">
          <div className="panel__header-copy">
            <span className="panel__eyebrow">{t.dashboard.holdingsEyebrow}</span>
            <h2>{t.dashboard.holdingsTitle}</h2>
          </div>
          <p className="panel__copy">Detail otevřených pozic v původní měně aktiva. Řazení používá market value nebo cost basis fallback v base měně.</p>
        </div>

        {holdings.length === 0 ? (
          <div className="empty-state">
            <h3>{t.dashboard.emptyHoldingsTitle}</h3>
            <p>{t.dashboard.emptyHoldingsDescription}</p>
          </div>
        ) : (
          <>
            <TableToolbar
              searchLabel={t.common.search}
              searchPlaceholder={t.dashboard.searchPlaceholder}
              searchValue={searchQuery}
              onSearchChange={setSearchQuery}
              filters={[
                {
                  label: t.common.currency,
                  value: currencyFilter,
                  onChange: setCurrencyFilter,
                  options: [
                    { value: "", label: t.common.allCurrencies },
                    ...currencyOptions.map((currency) => ({ value: currency, label: currency })),
                  ],
                },
                {
                  label: t.common.assetClass,
                  value: assetClassFilter,
                  onChange: setAssetClassFilter,
                  options: [
                    { value: "", label: t.common.allAssetClasses },
                    ...assetClassOptions.map((assetClass) => ({
                      value: assetClass,
                      label: t.common.assetClassLabels[assetClass as keyof typeof t.common.assetClassLabels],
                    })),
                  ],
                },
              ]}
              sortLabel={t.common.sortBy}
              sortOptions={[
                { value: "symbol", label: t.dashboard.sortSymbol },
                { value: "marketValue", label: t.dashboard.sortMarketValue },
                { value: "unrealizedPnL", label: t.dashboard.sortPnl },
                { value: "quantity", label: t.dashboard.sortQuantity },
              ]}
              sortValue={sortBy}
              onSortChange={(value) => setSortBy(value as HoldingsSortKey)}
              directionLabel={t.common.sortDirection}
              directionValue={sortDirection}
              directionOptions={[
                { value: "asc", label: t.common.sortAscending },
                { value: "desc", label: t.common.sortDescending },
              ]}
              onDirectionChange={(value) => setSortDirection(value as SortDirection)}
            />

            {filteredHoldings.length === 0 ? (
              <div className="empty-state">
                <h3>{t.common.emptyFilterTitle}</h3>
                <p>{t.common.emptyFilterDescription}</p>
              </div>
            ) : (
              <div className="table-wrap table-wrap--dashboard">
                <table className="data-table data-table--dashboard">
                  <thead>
                    <tr>
                      <th>{t.dashboard.tableAsset}</th>
                      <th>Sektor / region</th>
                      <th>{t.dashboard.tableAssetClass}</th>
                      <th>{t.dashboard.tableQuantity}</th>
                      <th>{t.dashboard.tableAverageCost}</th>
                      <th>{t.dashboard.tableCurrentPrice}</th>
                      <th>{t.dashboard.tablePriceSource}</th>
                      <th>{t.dashboard.tableCostBasis}</th>
                      <th>{t.dashboard.tableMarketValue}</th>
                      <th>{t.dashboard.tablePnl}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHoldings.map((holding) => (
                      <tr key={holding.assetId}>
                        <td className="cell-asset">
                          <div className="primary-cell primary-cell--asset">
                            <strong title={holding.symbol}>{holding.symbol}</strong>
                            <span title={holding.name}>{holding.name}</span>
                          </div>
                        </td>
                        <td className="cell-attribute">
                          <div className="primary-cell primary-cell--attribute">
                            <strong title={holding.sector}>{holding.sector}</strong>
                            <span title={`${holding.region} • ${holding.continent}`}>{holding.region} • {holding.continent}</span>
                          </div>
                        </td>
                        <td>
                          <span className="table-chip">{t.common.assetClassLabels[holding.assetClass]}</span>
                        </td>
                        <td className="cell-numeric">
                          <span className="table-number">{formatNumber(holding.quantity)}</span>
                        </td>
                        <td className="cell-numeric">
                          <span className="table-number" title={formatOptionalCurrency(holding.averageCost, holding.currency, t.common.notAvailableShort)}>
                            {formatOptionalCurrency(holding.averageCost, holding.currency, t.common.notAvailableShort)}
                          </span>
                        </td>
                        <td className="cell-numeric">
                          <span className="table-number" title={formatOptionalCurrency(holding.currentPrice, holding.currency, t.common.priceUnavailable)}>
                            {formatOptionalCurrency(holding.currentPrice, holding.currency, t.common.priceUnavailable)}
                          </span>
                        </td>
                        <td className="cell-source">
                          <span className="table-multiline">
                            {holding.priceSource === "market_data"
                              ? `${t.dashboard.priceSourceMarket}${holding.priceAsOf ? ` (${formatDateTime(holding.priceAsOf)})` : ""}`
                              : holding.priceSource === "stored"
                                ? t.dashboard.priceSourceStored
                                : t.dashboard.priceSourceUnavailable}
                          </span>
                        </td>
                        <td className="cell-numeric">
                          <span className="table-number" title={formatOptionalCurrency(holding.costBasis, holding.currency, t.common.notAvailableShort)}>
                            {formatOptionalCurrency(holding.costBasis, holding.currency, t.common.notAvailableShort)}
                          </span>
                        </td>
                        <td className="cell-numeric">
                          <span className="table-number" title={formatOptionalCurrency(holding.marketValue, holding.currency, t.common.marketValueUnavailable)}>
                            {formatOptionalCurrency(holding.marketValue, holding.currency, t.common.marketValueUnavailable)}
                          </span>
                        </td>
                        <td
                          className={`cell-numeric ${
                            holding.unrealizedPnL === null
                              ? ""
                              : holding.unrealizedPnL >= 0
                                ? "value-positive"
                                : "value-negative"
                          }`}
                        >
                          <span className="table-number" title={formatOptionalPnL(holding.unrealizedPnL, holding.currency, t.common.pnlUnavailable)}>
                            {formatOptionalPnL(holding.unrealizedPnL, holding.currency, t.common.pnlUnavailable)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
