export type SortDirection = "asc" | "desc";

export function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("cs-CZ")
    .trim();
}

export function matchesSearch(query: string, ...values: Array<string | null | undefined>): boolean {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return true;
  }

  return values.some((value) => normalizeSearchText(value).includes(normalizedQuery));
}

export function compareText(left: string | null | undefined, right: string | null | undefined): number {
  return (left ?? "").localeCompare(right ?? "", "cs-CZ", { sensitivity: "base" });
}

export function compareNumber(
  left: number | null | undefined,
  right: number | null | undefined,
  direction: SortDirection,
): number {
  const leftValue = left ?? (direction === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
  const rightValue = right ?? (direction === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);

  return direction === "asc" ? leftValue - rightValue : rightValue - leftValue;
}

export function applySortDirection(result: number, direction: SortDirection): number {
  return direction === "asc" ? result : result * -1;
}

export function getUniqueOptions(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)).map((value) => value.trim()))].sort(
    (left, right) => left.localeCompare(right, "cs-CZ"),
  );
}
