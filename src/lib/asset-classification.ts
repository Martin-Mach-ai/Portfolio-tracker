import type { Asset, AssetClass } from "@prisma/client";

export type AssetClassification = {
  sector: string;
  region: string;
  continent: string;
};

type ClassificationRule = AssetClassification;

const UNKNOWN_SECTOR = "Neznámé";
const OTHER_SECTOR = "Ostatní";
const UNKNOWN_REGION = "Neznámé";
const OTHER_REGION = "Ostatní";

const DIRECT_SYMBOL_RULES: Record<string, ClassificationRule> = {
  AAPL: { sector: "Technologie", region: "Severní Amerika", continent: "Severní Amerika" },
  AEHR: { sector: "Technologie", region: "Severní Amerika", continent: "Severní Amerika" },
  AMZN: { sector: "Consumer", region: "Severní Amerika", continent: "Severní Amerika" },
  ASML: { sector: "Technologie", region: "Evropa", continent: "Evropa" },
  BAT: { sector: "Consumer", region: "Evropa", continent: "Evropa" },
  BTC: { sector: OTHER_SECTOR, region: "Globální", continent: OTHER_REGION },
  BTCUSD: { sector: OTHER_SECTOR, region: "Globální", continent: OTHER_REGION },
  BTI: { sector: "Consumer", region: "Evropa", continent: "Evropa" },
  CEZ: { sector: "Energie", region: "Evropa", continent: "Evropa" },
  ETH: { sector: OTHER_SECTOR, region: "Globální", continent: OTHER_REGION },
  ETHEREUM: { sector: OTHER_SECTOR, region: "Globální", continent: OTHER_REGION },
  GOOGL: { sector: "Technologie", region: "Severní Amerika", continent: "Severní Amerika" },
  GOOG: { sector: "Technologie", region: "Severní Amerika", continent: "Severní Amerika" },
  JPM: { sector: "Finance", region: "Severní Amerika", continent: "Severní Amerika" },
  META: { sector: "Technologie", region: "Severní Amerika", continent: "Severní Amerika" },
  MSFT: { sector: "Technologie", region: "Severní Amerika", continent: "Severní Amerika" },
  NVDA: { sector: "Technologie", region: "Severní Amerika", continent: "Severní Amerika" },
  SAP: { sector: "Technologie", region: "Evropa", continent: "Evropa" },
  SHEL: { sector: "Energie", region: "Evropa", continent: "Evropa" },
  TSLA: { sector: "Consumer", region: "Severní Amerika", continent: "Severní Amerika" },
  V: { sector: "Finance", region: "Severní Amerika", continent: "Severní Amerika" },
};

const EUROPE_SUFFIXES = new Set([
  "AS",
  "AT",
  "BR",
  "CO",
  "CZ",
  "DE",
  "F",
  "HE",
  "L",
  "LN",
  "MC",
  "MI",
  "NL",
  "OL",
  "PA",
  "PR",
  "ST",
  "SW",
  "VI",
  "WA",
]);

const NORTH_AMERICA_SUFFIXES = new Set(["CA", "TO", "US", "V"]);
const ASIA_SUFFIXES = new Set(["HK", "JP", "KS", "KQ", "SH", "SI", "SS", "SZ", "T", "TAI", "TW"]);
const OCEANIA_SUFFIXES = new Set(["AU", "AX", "NZ"]);

const SECTOR_KEYWORDS: Array<{ match: RegExp; sector: string }> = [
  { match: /\b(bank|financial|insurance|capital|visa|mastercard)\b/i, sector: "Finance" },
  { match: /\b(energy|oil|gas|petroleum|shell|chevron|exxon)\b/i, sector: "Energie" },
  { match: /\b(health|pharma|biotech|medical|therapeutics)\b/i, sector: "Zdravotnictví" },
  { match: /\b(consumer|retail|beverage|food|luxury|tesla|amazon|disney)\b/i, sector: "Consumer" },
  { match: /\b(industrial|aerospace|rail|machinery|engineering|defense)\b/i, sector: "Průmysl" },
  { match: /\b(software|cloud|tech|technology|semiconductor|chip|nvidia|apple|microsoft|alphabet|meta)\b/i, sector: "Technologie" },
];

const REGION_KEYWORDS: Array<{ match: RegExp; region: string; continent: string }> = [
  { match: /\b(europe|euro|european|germany|france|netherlands|czech|poland|uk|britain)\b/i, region: "Evropa", continent: "Evropa" },
  { match: /\b(asia|asian|japan|china|india|taiwan|korea|singapore)\b/i, region: "Asie", continent: "Asie" },
  { match: /\b(usa|u\.s\.|united states|nasdaq|s&p 500|north america|canada)\b/i, region: "Severní Amerika", continent: "Severní Amerika" },
];

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function normalizeSymbolKey(symbol: string): string {
  const normalized = normalizeSymbol(symbol);
  const [base] = normalized.split(".");

  return base ?? normalized;
}

function getSymbolSuffix(symbol: string): string | null {
  const normalized = normalizeSymbol(symbol);
  const match = normalized.match(/\.([A-Z]{1,4})$/);

  return match?.[1] ?? null;
}

function inferRegionFromSymbolOrCurrency(symbol: string, currency: string): Pick<AssetClassification, "region" | "continent"> {
  const suffix = getSymbolSuffix(symbol);

  if (suffix && EUROPE_SUFFIXES.has(suffix)) {
    return { region: "Evropa", continent: "Evropa" };
  }

  if (suffix && NORTH_AMERICA_SUFFIXES.has(suffix)) {
    return { region: "Severní Amerika", continent: "Severní Amerika" };
  }

  if (suffix && ASIA_SUFFIXES.has(suffix)) {
    return { region: "Asie", continent: "Asie" };
  }

  if (suffix && OCEANIA_SUFFIXES.has(suffix)) {
    return { region: OTHER_REGION, continent: OTHER_REGION };
  }

  switch (currency.toUpperCase()) {
    case "CZK":
    case "EUR":
    case "GBP":
    case "CHF":
    case "PLN":
      return { region: "Evropa", continent: "Evropa" };
    case "USD":
    case "CAD":
      return { region: "Severní Amerika", continent: "Severní Amerika" };
    case "JPY":
    case "CNY":
    case "HKD":
      return { region: "Asie", continent: "Asie" };
    default:
      return { region: UNKNOWN_REGION, continent: UNKNOWN_REGION };
  }
}

function inferRegionFromName(name: string): Pick<AssetClassification, "region" | "continent"> | null {
  for (const rule of REGION_KEYWORDS) {
    if (rule.match.test(name)) {
      return { region: rule.region, continent: rule.continent };
    }
  }

  return null;
}

function inferSectorFromName(name: string): string {
  for (const rule of SECTOR_KEYWORDS) {
    if (rule.match.test(name)) {
      return rule.sector;
    }
  }

  return UNKNOWN_SECTOR;
}

function inferSectorByAssetClass(assetClass: AssetClass): string {
  switch (assetClass) {
    case "CRYPTO":
    case "FOREX":
      return OTHER_SECTOR;
    case "ETF":
      return OTHER_SECTOR;
    case "CFD":
    case "UNKNOWN":
    case "STOCK":
    default:
      return UNKNOWN_SECTOR;
  }
}

export function inferAssetClassification(asset: Pick<Asset, "symbol" | "name" | "currency" | "assetClass">): AssetClassification {
  const symbolKey = normalizeSymbolKey(asset.symbol);
  const directRule = DIRECT_SYMBOL_RULES[symbolKey];

  if (directRule) {
    return directRule;
  }

  if (asset.assetClass === "CRYPTO" || asset.assetClass === "FOREX") {
    return {
      sector: OTHER_SECTOR,
      region: "Globální",
      continent: OTHER_REGION,
    };
  }

  const inferredRegion = inferRegionFromName(asset.name) ?? inferRegionFromSymbolOrCurrency(asset.symbol, asset.currency);
  const inferredSector = inferSectorFromName(asset.name);
  const sector = inferredSector === UNKNOWN_SECTOR ? inferSectorByAssetClass(asset.assetClass) : inferredSector;

  return {
    sector,
    region: inferredRegion.region,
    continent: inferredRegion.continent,
  };
}
