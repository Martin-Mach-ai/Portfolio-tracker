const APP_LOCALE = "cs-CZ";

export function formatCurrency(value: number, currency = "USD"): string {
  return new Intl.NumberFormat(APP_LOCALE, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(APP_LOCALE, {
    maximumFractionDigits: 6,
  }).format(value);
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    dateStyle: "medium",
  }).format(new Date(value));
}

export function formatPnL(value: number, currency = "USD"): string {
  const formatted = formatCurrency(Math.abs(value), currency);

  if (value === 0) {
    return formatted;
  }

  return `${value > 0 ? "+" : "-"}${formatted}`;
}

export function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function formatOptionalCurrency(value: number | null | undefined, currency = "USD", fallback = "N/A"): string {
  if (value === null || value === undefined) {
    return fallback;
  }

  return formatCurrency(value, currency);
}

export function formatOptionalPnL(value: number | null | undefined, currency = "USD", fallback = "N/A"): string {
  if (value === null || value === undefined) {
    return fallback;
  }

  return formatPnL(value, currency);
}
