import type { CSSProperties } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { CATEGORY_CHART_COLORS } from "../lib/chart-theme";
import type { TopHolding } from "../lib/dashboard-utils";
import { formatCurrency, formatPercent } from "../lib/format";

type TopHoldingsChartProps = {
  holdings: TopHolding[];
  currency: string;
};

export function TopHoldingsChart({ holdings, currency }: TopHoldingsChartProps) {
  if (holdings.length === 0) {
    return (
      <div className="empty-state">
        <h3>Top pozice zatím nejsou dostupné</h3>
        <p>Chybí oceněné nebo přepočitatelné pozice. Jakmile budou k dispozici ceny nebo cost basis v base měně, graf se doplní.</p>
      </div>
    );
  }

  const chartData = [...holdings].reverse();

  return (
    <div className="top-holdings-layout">
      <div className="chart-shell chart-shell--medium">
        <ResponsiveContainer width="100%" height={340}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
            <XAxis
              type="number"
              stroke="rgba(196, 214, 255, 0.78)"
              tickFormatter={(value) => formatCurrency(Number(value), currency)}
            />
            <YAxis type="category" dataKey="symbol" width={84} stroke="rgba(196, 214, 255, 0.78)" />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
              contentStyle={{
                background: "rgba(8, 18, 36, 0.96)",
                border: "1px solid rgba(125, 175, 255, 0.18)",
                borderRadius: "18px",
              }}
              formatter={(value, _name, item) => {
                const numericValue = typeof value === "number" ? value : Number(value);
                const payload = item.payload as TopHolding | undefined;
                const sourceLabel = payload?.valueSource === "marketValue" ? "Market value" : "Cost basis";

                return [
                  formatCurrency(numericValue, currency),
                  payload ? `${payload.symbol} • ${sourceLabel} • ${formatPercent(payload.percentage)}` : "Pozice",
                ];
              }}
              labelFormatter={(label) => `Ticker: ${label}`}
            />
            <Bar dataKey="value" radius={[0, 14, 14, 0]}>
              {chartData.map((item, index) => (
                <Cell key={item.assetId} fill={CATEGORY_CHART_COLORS[index % CATEGORY_CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="top-holdings-list">
        {holdings.map((holding, index) => (
          <article
            key={holding.assetId}
            className="top-holding-item"
            style={{ "--holding-color": CATEGORY_CHART_COLORS[index % CATEGORY_CHART_COLORS.length] } as CSSProperties}
          >
            <div className="top-holding-item__content">
              <span className="top-holding-item__rank">#{index + 1}</span>
              <div className="top-holding-item__identity">
                <span className="top-holding-item__swatch" aria-hidden="true" />
                <strong className="top-holding-item__symbol" title={holding.symbol}>{holding.symbol}</strong>
                <span className="top-holding-item__currency">{holding.currency}</span>
              </div>
              <p className="top-holding-item__name" title={holding.name}>{holding.name}</p>
              <span className="top-holding-item__sector" title={holding.sector}>{holding.sector}</span>
            </div>
            <div className="top-holding-item__values">
              <strong title={formatCurrency(holding.value, currency)}>{formatCurrency(holding.value, currency)}</strong>
              <span>{formatPercent(holding.percentage)}</span>
              <span className="top-holding-item__meta">
                {holding.valueSource === "marketValue" ? "Market value" : "Cost basis fallback"}
              </span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
