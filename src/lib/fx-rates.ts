const USD_BASE_FALLBACK_RATES: Record<string, number> = {
  CHF: 1.13,
  CZK: 0.043,
  EUR: 1.09,
  GBP: 1.28,
  GBX: 0.0128,
  PLN: 0.25,
};

function roundFxRate(value: number): number {
  return Number(value.toFixed(6));
}

export function resolveUsdFxRate(currency: string, liveRate: number | null | undefined): number | null {
  const normalizedCurrency = currency.trim().toUpperCase();

  if (normalizedCurrency === "USD") {
    return 1;
  }

  if (typeof liveRate === "number" && Number.isFinite(liveRate) && liveRate > 0) {
    return roundFxRate(liveRate);
  }

  const fallbackRate = USD_BASE_FALLBACK_RATES[normalizedCurrency];
  return typeof fallbackRate === "number" ? roundFxRate(fallbackRate) : null;
}
