import { TransactionType, type Prisma } from "@prisma/client";

import { AppError } from "./errors";

export type LedgerTransaction = {
  id: string;
  assetId: string;
  type: TransactionType;
  quantity: Prisma.Decimal | number | string;
  price: Prisma.Decimal | number | string;
  fee: Prisma.Decimal | number | string;
  occurredAt: Date;
  createdAt: Date;
};

export type HoldingMetrics = {
  quantity: number;
  averageCost: number;
  costBasis: number;
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPnL: number | null;
  hasMarketPrice: boolean;
};

export type LedgerMetrics = HoldingMetrics & {
  realizedPnL: number;
};

const EPSILON = 1e-8;

export function toNumber(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return Number(value);
  }

  return value.toNumber();
}

export function toOptionalNumber(value: Prisma.Decimal | number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = toNumber(value);

  return Number.isFinite(numeric) ? numeric : null;
}

export function toOptionalMarketPrice(value: Prisma.Decimal | number | string | null | undefined): number | null {
  const numeric = toOptionalNumber(value);

  if (numeric === null || numeric <= 0) {
    return null;
  }

  return numeric;
}

export function sortLedgerTransactions<T extends LedgerTransaction>(transactions: T[]): T[] {
  return [...transactions].sort((left, right) => {
    const occurredDiff = left.occurredAt.getTime() - right.occurredAt.getTime();

    if (occurredDiff !== 0) {
      return occurredDiff;
    }

    const createdDiff = left.createdAt.getTime() - right.createdAt.getTime();

    if (createdDiff !== 0) {
      return createdDiff;
    }

    return left.id.localeCompare(right.id);
  });
}

export function assertLedgerIsValid(transactions: LedgerTransaction[]): void {
  let quantityHeld = 0;

  for (const transaction of sortLedgerTransactions(transactions)) {
    const quantity = toNumber(transaction.quantity);

    quantityHeld += transaction.type === TransactionType.BUY ? quantity : -quantity;

    if (quantityHeld < -EPSILON) {
      throw new AppError(
        422,
        "INVALID_LEDGER",
        "Transaction would sell more units than currently owned",
        { transactionId: transaction.id, assetId: transaction.assetId },
      );
    }
  }
}

export function calculateLedgerMetrics(
  transactions: LedgerTransaction[],
  currentPriceInput: Prisma.Decimal | number | string | null | undefined,
): LedgerMetrics {
  let quantityHeld = 0;
  let costBasis = 0;
  let realizedPnL = 0;

  for (const transaction of sortLedgerTransactions(transactions)) {
    const quantity = toNumber(transaction.quantity);
    const price = toNumber(transaction.price);
    const fee = toNumber(transaction.fee);

    if (transaction.type === TransactionType.BUY) {
      quantityHeld += quantity;
      costBasis += quantity * price + fee;
      continue;
    }

    if (quantityHeld <= EPSILON) {
      throw new AppError(422, "INVALID_LEDGER", "Cannot sell an asset with zero holdings");
    }

    const averageCost = costBasis / quantityHeld;
    const proceeds = quantity * price - fee;
    realizedPnL += proceeds - averageCost * quantity;
    costBasis -= averageCost * quantity;
    quantityHeld -= quantity;

    if (quantityHeld < EPSILON) {
      quantityHeld = 0;
      costBasis = 0;
    }
  }

  const currentPrice = toOptionalMarketPrice(currentPriceInput);
  const averageCost = quantityHeld > EPSILON ? costBasis / quantityHeld : 0;
  const marketValue = currentPrice === null ? null : quantityHeld * currentPrice;
  const unrealizedPnL = marketValue === null ? null : marketValue - costBasis;

  return {
    quantity: roundNumber(quantityHeld),
    averageCost: roundNumber(averageCost),
    costBasis: roundNumber(costBasis),
    currentPrice: currentPrice === null ? null : roundNumber(currentPrice),
    marketValue: marketValue === null ? null : roundNumber(marketValue),
    unrealizedPnL: unrealizedPnL === null ? null : roundNumber(unrealizedPnL),
    hasMarketPrice: currentPrice !== null,
    realizedPnL: roundNumber(realizedPnL),
  };
}

export function calculateHoldingMetrics(
  transactions: LedgerTransaction[],
  currentPriceInput: Prisma.Decimal | number | string | null | undefined,
): HoldingMetrics {
  const { realizedPnL: _realizedPnL, ...metrics } = calculateLedgerMetrics(transactions, currentPriceInput);

  return metrics;
}

export function roundNumber(value: number): number {
  return Number(value.toFixed(6));
}
