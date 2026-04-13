import { useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { PortfolioPerformance } from "../lib/api";
import { CHART_SERIES_COLORS } from "../lib/chart-theme";
import { formatCurrency, formatDate } from "../lib/format";

type PortfolioHistoryChartProps = {
  performance: PortfolioPerformance;
};

type HistoryMode = "value" | "pnl";

function resolveNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (Array.isArray(value) && value.length > 0) {
    return resolveNumber(value[0]);
  }

  return null;
}

export function PortfolioHistoryChart({ performance }: PortfolioHistoryChartProps) {
  const [mode, setMode] = useState<HistoryMode>("value");
  const hasCostBasisHistory = performance.coverage.costBasisPointCount > 0;
  const hasMarketValueHistory = performance.coverage.marketValuePointCount > 0;
  const hasPnlHistory = performance.points.some((point) => point.unrealizedPnL !== null);
  const hasBenchmarkHistory = performance.points.some((point) => point.benchmarkValue !== null);

  if (!hasCostBasisHistory && !hasMarketValueHistory) {
    return (
      <div className="empty-state">
        <h3>Historie zatím není dostupná</h3>
        <p>Data zatím nejsou dostupná. Graf se zobrazí po načtení transakcí nebo alespoň části cenové historie.</p>
      </div>
    );
  }

  const chartData = performance.points.map((point) => ({
    ...point,
    pnlSeries: point.unrealizedPnL,
  }));
  const showHistoryWarning = hasMarketValueHistory && performance.coverage.marketValuePointCount < performance.points.length;

  return (
    <div className="performance-stack">
      <div className="chart-toolbar">
        <div className="chart-toggle" role="group" aria-label="Režim grafu portfolia">
          <button
            type="button"
            className={mode === "value" ? "primary-button" : "ghost-button"}
            onClick={() => setMode("value")}
          >
            Hodnota
          </button>
          <button
            type="button"
            className={mode === "pnl" ? "primary-button" : "ghost-button"}
            onClick={() => setMode("pnl")}
            disabled={!hasPnlHistory}
          >
            P/L
          </button>
        </div>
        <p className="panel__copy">Graf pracuje s tím, co je dostupné. Market value se vykreslí částečně, cost basis drží průběh i bez kompletní ceny.</p>
      </div>

      <div className="chart-legend" aria-label="Legenda grafu historie">
        {mode === "value" ? (
          <>
            {hasMarketValueHistory ? (
              <span className="chart-legend__item">
                <span className="chart-legend__swatch chart-legend__swatch--portfolio" aria-hidden="true" />
                Portfolio value
              </span>
            ) : null}
            {hasBenchmarkHistory ? (
              <span className="chart-legend__item">
                <span className="chart-legend__swatch chart-legend__swatch--benchmark" aria-hidden="true" />
                Benchmark
              </span>
            ) : null}
            <span className="chart-legend__item">
              <span className="chart-legend__swatch chart-legend__swatch--cost-basis" aria-hidden="true" />
              Cost basis
            </span>
          </>
        ) : (
          <span className="chart-legend__item">
            <span className="chart-legend__swatch chart-legend__swatch--positive" aria-hidden="true" />
            Unrealized P/L
          </span>
        )}
      </div>

      {showHistoryWarning ? (
        <div className="form-message form-message--warning">
          <p>
            Market value historie je dostupná pro {performance.coverage.marketValuePointCount} z {performance.points.length} bodů.
            Cost basis zůstává jako fallback i pro zbývající období.
          </p>
        </div>
      ) : null}

      {!hasMarketValueHistory && hasCostBasisHistory ? (
        <div className="form-message form-message--info">
          <p>Market value není k dispozici. Zobrazuje se alespoň průběh cost basis z ledgeru.</p>
        </div>
      ) : null}

      <div className="chart-shell chart-shell--tall">
        <ResponsiveContainer width="100%" height={360}>
          <ComposedChart data={chartData} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="historyArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_SERIES_COLORS.portfolio} stopOpacity={0.4} />
                <stop offset="100%" stopColor={CHART_SERIES_COLORS.portfolio} stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="pnlArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_SERIES_COLORS.positive} stopOpacity={0.32} />
                <stop offset="100%" stopColor={CHART_SERIES_COLORS.positive} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="4 4" />
            <XAxis dataKey="date" tickFormatter={formatDate} minTickGap={28} stroke="rgba(196, 214, 255, 0.78)" />
            <YAxis
              width={92}
              stroke="rgba(196, 214, 255, 0.78)"
              tickFormatter={(value) => formatCurrency(Number(value), performance.currency)}
            />
            <Tooltip
              contentStyle={{
                background: "rgba(8, 18, 36, 0.96)",
                border: "1px solid rgba(125, 175, 255, 0.18)",
                borderRadius: "18px",
              }}
              labelFormatter={(label) => formatDate(String(label))}
              formatter={(value, _name, item) => {
                const numericValue = resolveNumber(value);

                if (numericValue === null) {
                  return ["Data nejsou k dispozici", item.name ?? "Řada"];
                }

                return [formatCurrency(numericValue, performance.currency), item.name ?? "Řada"];
              }}
            />
            {mode === "pnl" ? <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" /> : null}
            {mode === "value" ? (
              <>
                {hasMarketValueHistory ? (
                  <Area
                    type="monotone"
                    dataKey="portfolioValue"
                    name="Portfolio value"
                    stroke={CHART_SERIES_COLORS.portfolio}
                    fill="url(#historyArea)"
                    strokeWidth={3.2}
                    dot={false}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                  />
                ) : null}
                {hasBenchmarkHistory ? (
                  <Line
                    type="monotone"
                    dataKey="benchmarkValue"
                    name={performance.benchmarkLabel}
                    stroke={CHART_SERIES_COLORS.benchmark}
                    strokeWidth={2.4}
                    strokeDasharray="8 6"
                    dot={false}
                    activeDot={{ r: 4 }}
                    connectNulls={true}
                  />
                ) : null}
                <Line
                  type="monotone"
                  dataKey="costBasis"
                  name="Cost basis"
                  stroke={CHART_SERIES_COLORS.costBasis}
                  strokeWidth={2.4}
                  strokeDasharray="4 5"
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls={true}
                />
              </>
            ) : (
              <Area
                type="monotone"
                dataKey="pnlSeries"
                name="Unrealized P/L"
                stroke={CHART_SERIES_COLORS.positive}
                fill="url(#pnlArea)"
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 5 }}
                connectNulls={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
