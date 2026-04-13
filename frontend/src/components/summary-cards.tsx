import type { DashboardSummary } from "../lib/dashboard-utils";
import { formatCurrency, formatOptionalCurrency, formatOptionalPnL } from "../lib/format";
import { t } from "../lib/i18n";

type SummaryCardsProps = {
  summary: DashboardSummary;
};

export function SummaryCards({ summary }: SummaryCardsProps) {
  const items = [
    {
      label: t.summary.marketValue,
      value: formatOptionalCurrency(summary.marketValue, summary.baseCurrency, t.common.marketValueUnavailable),
      tone: "portfolio",
      meta: summary.marketValue === null ? "Fallback běží jen tam, kde není live cena." : "Součet oceněných pozic v base měně.",
    },
    {
      label: t.summary.costBasis,
      value: summary.costBasis === null ? t.common.notAvailableShort : formatCurrency(summary.costBasis, summary.baseCurrency),
      tone: "cost-basis",
      meta: "Včetně neoceněných pozic, pokud mají použitelný base přepočet.",
    },
    {
      label: t.summary.unrealizedPnL,
      value: formatOptionalPnL(summary.unrealizedPnL, summary.baseCurrency, t.common.pnlUnavailable),
      tone: summary.unrealizedPnL === null ? "neutral" : summary.unrealizedPnL >= 0 ? "positive" : "negative",
      meta: summary.unrealizedPnL === null ? "PnL se dopočítá až s dostupnou market value." : "Rozdíl market value a cost basis.",
    },
    {
      label: t.summary.realizedPnL,
      value: formatOptionalPnL(summary.realizedPnL, summary.baseCurrency, t.common.pnlUnavailable),
      tone: summary.realizedPnL === null ? "neutral" : summary.realizedPnL >= 0 ? "positive" : "negative",
      meta: "Z uzavřených částí pozic v base měně.",
    },
    {
      label: t.summary.activeAssets,
      value: `${summary.openPositionCount}`,
      tone: "neutral",
      meta: `${summary.pricedAssetCount} s market value, ${summary.unpricedAssetCount} na fallbacku nebo bez ceny.`,
    },
    {
      label: t.summary.unpricedAssets,
      value: `${summary.unpricedAssetCount}`,
      tone: summary.unpricedAssetCount > 0 ? "warning" : "positive",
      meta: summary.unpricedAssetCount > 0 ? "Tyto pozice zůstávají v přehledu přes cost basis, kde to jde." : "Všechny pozice mají aktuální cenu.",
    },
  ] as const;

  return (
    <section className="summary-grid" aria-label={t.summary.ariaLabel}>
      {items.map((item) => (
        <article key={item.label} className={`summary-card summary-card--${item.tone}`}>
          <span className="summary-card__label">{item.label}</span>
          <strong className="summary-card__value">{item.value}</strong>
          <p className="summary-card__meta">{item.meta}</p>
        </article>
      ))}
    </section>
  );
}
