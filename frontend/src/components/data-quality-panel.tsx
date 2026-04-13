import type { Holding, PortfolioPerformance } from "../lib/api";

type DataQualityPanelProps = {
  holdings: Holding[];
  performance?: PortfolioPerformance | null;
};

function summarizeList(items: string[], maxItems = 4): string {
  if (items.length <= maxItems) {
    return items.join(", ");
  }

  const visibleItems = items.slice(0, maxItems).join(", ");
  return `${visibleItems} +${items.length - maxItems}`;
}

export function DataQualityPanel({ holdings, performance }: DataQualityPanelProps) {
  const coverage = performance?.coverage;
  const missingSymbols = Array.isArray(coverage?.missingSymbols) ? coverage.missingSymbols : [];
  const missingCurrencies = Array.isArray(coverage?.missingCurrencies) ? coverage.missingCurrencies : [];
  const assetsWithoutLivePriceCount = holdings.filter((holding) => holding.marketValue === null).length;
  const costFallbackCount = holdings.filter(
    (holding) => holding.marketValueBase === null && holding.costBasisBase !== null,
  ).length;
  const excludedBreakdownCount = holdings.filter(
    (holding) => holding.marketValueBase === null && holding.costBasisBase === null,
  ).length;
  const isUnknownLabel = (value: string | null | undefined) => value?.trim().toLowerCase().startsWith("neznám") ?? false;
  const unclassifiedCount = holdings.filter(
    (holding) => isUnknownLabel(holding.sector) || isUnknownLabel(holding.region) || isUnknownLabel(holding.continent),
  ).length;
  const marketValuePointCount = coverage?.marketValuePointCount ?? 0;
  const costBasisPointCount = coverage?.costBasisPointCount ?? 0;
  const notes: string[] = [];

  if (assetsWithoutLivePriceCount > 0) {
    notes.push("Část pozic nemá live cenu. Dashboard u nich používá cost basis fallback všude, kde je k dispozici base přepočet.");
  }

  if (excludedBreakdownCount > 0) {
    notes.push("Jen malá část pozic chybí i v breakdown grafech, protože není dostupná ani base hodnota z cost basis.");
  }

  if (missingSymbols.length > 0) {
    notes.push(`Chybí historie pro symboly: ${summarizeList(missingSymbols)}.`);
  }

  if (missingCurrencies.length > 0) {
    notes.push(`Chybí FX historie pro měny: ${summarizeList(missingCurrencies)}.`);
  }

  if (unclassifiedCount > 0) {
    notes.push("Některá aktiva spadla do fallback kategorií neznámého sektoru nebo regionu.");
  }

  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <span className="panel__eyebrow">Kvalita dat</span>
          <h2>Kontrola pokrytí dashboardu</h2>
        </div>
        <p className="panel__copy">Krátké shrnutí toho, co může omezit grafy, top pozice nebo alokační breakdowny.</p>
      </div>

      <div className="summary-grid data-quality-grid">
        <article className={`summary-card ${assetsWithoutLivePriceCount > 0 ? "summary-card--warning" : "summary-card--positive"}`}>
          <span>Aktiva bez live ceny</span>
          <strong>{assetsWithoutLivePriceCount}</strong>
          <p className="summary-card__meta">
            {assetsWithoutLivePriceCount === 0
              ? "Všechny otevřené pozice mají aktuální ocenění."
              : "Pro tyto pozice se dashboard přepíná na cost basis fallback."}
          </p>
        </article>

        <article className={`summary-card ${costFallbackCount > 0 ? "summary-card--warning" : "summary-card--positive"}`}>
          <span>Pozice na cost basis fallbacku</span>
          <strong>{costFallbackCount}</strong>
          <p className="summary-card__meta">
            {costFallbackCount === 0
              ? "Agregace jedou z market value bez náhradní vrstvy."
              : "Tyto pozice zůstávají v top holdings i donutech i bez live ceny."}
          </p>
        </article>

        <article className={`summary-card ${marketValuePointCount > 0 ? "summary-card--portfolio" : "summary-card--negative"}`}>
          <span>Body market value historie</span>
          <strong>{marketValuePointCount}</strong>
          <p className="summary-card__meta">
            {marketValuePointCount > 0
              ? "Historie hodnoty portfolia se vykreslí jen pro tyto body."
              : "Market value historie zatím chybí."}
          </p>
        </article>

        <article className={`summary-card ${excludedBreakdownCount > 0 ? "summary-card--negative" : "summary-card--positive"}`}>
          <span>Pozice mimo breakdowny</span>
          <strong>{excludedBreakdownCount}</strong>
          <p className="summary-card__meta">
            {excludedBreakdownCount === 0
              ? "Každá otevřená pozice se propsala do agregací."
              : "Jen tyto pozice chybí i po fallbacku, protože nemají bezpečně určitelnou base hodnotu."}
          </p>
        </article>

        <article className={`summary-card ${costBasisPointCount > 0 ? "summary-card--cost-basis" : "summary-card--negative"}`}>
          <span>Body cost basis historie</span>
          <strong>{costBasisPointCount}</strong>
          <p className="summary-card__meta">
            {costBasisPointCount > 0
              ? "Cost basis zůstává fallback vrstvou pro časovou osu."
              : "Cost basis historie zatím není dostupná."}
          </p>
        </article>

        <article className={`summary-card ${unclassifiedCount > 0 ? "summary-card--warning" : "summary-card--positive"}`}>
          <span>Neklasifikovaná aktiva</span>
          <strong>{unclassifiedCount}</strong>
          <p className="summary-card__meta">
            {unclassifiedCount === 0
              ? "Sektor i region jsou určené pro všechny pozice."
              : "Chybějící metadata padají do čitelných kategorií místo vyřazení z grafu."}
          </p>
        </article>
      </div>

      <div className="data-quality-notes">
        {notes.length > 0 ? notes.map((note) => <p key={note}>{note}</p>) : <p>Pokrytí dat je pro dashboard kompletní.</p>}
      </div>
    </section>
  );
}
