import type { CSSProperties } from "react";
import type { TooltipProps } from "recharts";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { CATEGORY_CHART_COLORS } from "../lib/chart-theme";
import type { AllocationBreakdown, AllocationSlice } from "../lib/dashboard-utils";
import { formatCurrency, formatPercent } from "../lib/format";

type AllocationDonutChartProps = {
  title: string;
  description: string;
  breakdown: AllocationBreakdown;
  currency: string;
  emptyTitle: string;
  emptyDescription: string;
};

function formatPositionsLabel(count: number): string {
  if (count === 1) {
    return "1 pozice";
  }

  if (count >= 2 && count <= 4) {
    return `${count} pozice`;
  }

  return `${count} pozic`;
}

function AllocationTooltip({ active, payload, currency }: TooltipProps<number, string> & { currency: string }) {
  const item = payload?.[0]?.payload as AllocationSlice | undefined;

  if (!active || !item) {
    return null;
  }

  return (
    <div className="chart-tooltip chart-tooltip--allocation">
      <strong>{item.label}</strong>
      <span>{formatCurrency(item.value, currency)}</span>
      <span>{formatPercent(item.percentage)} • {formatPositionsLabel(item.holdingCount)}</span>
    </div>
  );
}

export function AllocationDonutChart({
  title,
  description,
  breakdown,
  currency,
  emptyTitle,
  emptyDescription,
}: AllocationDonutChartProps) {
  const hasData = breakdown.items.length > 0 && breakdown.total > 0;
  const categoryCountLabel = breakdown.items.length === 1 ? "1 kategorie" : `${breakdown.items.length} kategorií`;
  const fallbackLabel =
    breakdown.costBasisHoldings > 0
      ? `Fallback: ${formatPositionsLabel(breakdown.costBasisHoldings)}`
      : "Live value tam, kde je k dispozici";

  return (
    <article className="dashboard-card dashboard-card--allocation">
      <div className="dashboard-card__header">
        <div className="dashboard-card__heading">
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <div className="dashboard-card__meta">
          <span className="dashboard-chip">V grafu: {breakdown.includedHoldings}</span>
          {breakdown.excludedHoldings > 0 ? <span className="dashboard-chip">Mimo graf: {breakdown.excludedHoldings}</span> : null}
          <span className="dashboard-chip">{categoryCountLabel}</span>
        </div>
      </div>

      <div className={`dashboard-note ${breakdown.costBasisHoldings > 0 ? "dashboard-note--info" : ""}`}>
        <span>{fallbackLabel}</span>
      </div>

      {hasData ? (
        <div className="donut-layout">
          <div className="donut-visual">
            <div className="chart-shell chart-shell--donut">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={breakdown.items}
                    dataKey="value"
                    nameKey="label"
                    innerRadius={58}
                    outerRadius={88}
                    paddingAngle={2}
                    stroke="rgba(18, 20, 28, 0.45)"
                    strokeWidth={2}
                  >
                    {breakdown.items.map((item, index) => (
                      <Cell key={item.label} fill={CATEGORY_CHART_COLORS[index % CATEGORY_CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    allowEscapeViewBox={{ x: true, y: true }}
                    cursor={{ fill: "rgba(255,255,255,0.04)" }}
                    wrapperStyle={{ zIndex: 12, outline: "none" }}
                    content={<AllocationTooltip currency={currency} />}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="donut-center" aria-hidden="true">
              <span>Celkem</span>
              <strong>{formatCurrency(breakdown.total, currency)}</strong>
              <p>{categoryCountLabel}</p>
            </div>
          </div>

          <div className="breakdown-list" aria-label={title}>
            {breakdown.items.map((item, index) => (
              <div
                key={item.label}
                className="breakdown-row"
                style={{ "--slice-color": CATEGORY_CHART_COLORS[index % CATEGORY_CHART_COLORS.length] } as CSSProperties}
              >
                <div className="breakdown-row__label">
                  <span className="breakdown-swatch" aria-hidden="true" />
                  <strong className="breakdown-row__title" title={item.label}>{item.label}</strong>
                </div>
                <div className="breakdown-row__values">
                  <span className="breakdown-row__share">{formatPercent(item.percentage)}</span>
                  <span className="breakdown-row__count">{formatPositionsLabel(item.holdingCount)}</span>
                  <span className="breakdown-row__amount" title={formatCurrency(item.value, currency)}>
                    {formatCurrency(item.value, currency)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="empty-state empty-state--compact">
          <h3>{emptyTitle}</h3>
          <p>{emptyDescription}</p>
        </div>
      )}

      {hasData ? (
        <p className="dashboard-footnote">
          {breakdown.excludedHoldings > 0
            ? `${formatPositionsLabel(breakdown.includedHoldings)} v grafu, ${formatPositionsLabel(breakdown.excludedHoldings)} bez použitelné base hodnoty.`
            : `Všech ${breakdown.includedHoldings} pozic je v grafu.`}
        </p>
      ) : null}
    </article>
  );
}
