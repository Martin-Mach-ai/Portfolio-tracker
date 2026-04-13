import { Prisma, TransactionType, type Transaction } from "@prisma/client";
import { Router } from "express";

import { AppError, asyncHandler } from "../lib/errors";
import {
  assertLedgerIsValid,
  sortLedgerTransactions,
  toNumber,
  type LedgerTransaction,
} from "../lib/portfolio";
import { prisma } from "../lib/prisma";
import { parseWithSchema } from "../lib/validation";
import {
  createTransactionSchema,
  transactionQuerySchema,
  updateTransactionSchema,
} from "../schemas/transactions";

export const transactionsRouter = Router();

type TransactionWithAsset = Prisma.TransactionGetPayload<{
  include: { asset: true };
}>;

type DraftTransaction = Omit<Transaction, "updatedAt">;

function serializeTransaction(
  transaction: Transaction & {
    asset: {
      id: string;
      symbol: string;
      name: string;
      currency: string;
    };
  },
) {
  return {
    id: transaction.id,
    assetId: transaction.assetId,
    type: transaction.type,
    quantity: toNumber(transaction.quantity),
    price: toNumber(transaction.price),
    fee: toNumber(transaction.fee),
    occurredAt: transaction.occurredAt,
    note: transaction.note,
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
    asset: {
      id: transaction.asset.id,
      symbol: transaction.asset.symbol,
      name: transaction.asset.name,
      currency: transaction.asset.currency,
    },
  };
}

async function ensureAssetExists(assetId: string): Promise<void> {
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { id: true },
  });

  if (!asset) {
    throw new AppError(404, "ASSET_NOT_FOUND", "Asset not found");
  }
}

async function assertValidLedgerForAsset(
  assetId: string,
  options?: { draftTransaction?: DraftTransaction; excludeTransactionId?: string },
): Promise<void> {
  const transactions = await prisma.transaction.findMany({
    where: { assetId },
    orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  const nextTransactions: LedgerTransaction[] = transactions.filter(
    (transaction) => transaction.id !== options?.excludeTransactionId,
  );

  if (options?.draftTransaction) {
    nextTransactions.push(options.draftTransaction);
  }

  assertLedgerIsValid(sortLedgerTransactions(nextTransactions));
}

function buildDraftTransaction(
  transaction: Omit<Transaction, "updatedAt">,
  overrides: Partial<Omit<Transaction, "updatedAt">>,
): DraftTransaction {
  return {
    ...transaction,
    ...overrides,
  };
}

transactionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const filters = parseWithSchema(transactionQuerySchema, {
      assetId: typeof req.query.assetId === "string" ? req.query.assetId : undefined,
      type: typeof req.query.type === "string" ? req.query.type : undefined,
    });

    const transactions = await prisma.transaction.findMany({
      where: {
        assetId: filters.assetId,
        type: filters.type as TransactionType | undefined,
      },
      include: { asset: true },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });

    res.json({ data: transactions.map(serializeTransaction) });
  }),
);

transactionsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parseWithSchema(createTransactionSchema, req.body);

    await ensureAssetExists(input.assetId);

    const draftTransaction: DraftTransaction = {
      id: `draft-${Date.now()}`,
      assetId: input.assetId,
      type: input.type as TransactionType,
      quantity: new Prisma.Decimal(input.quantity),
      price: new Prisma.Decimal(input.price),
      fee: new Prisma.Decimal(input.fee ?? 0),
      occurredAt: input.occurredAt,
      note: input.note ?? null,
      importLeg: null,
      importedPositionId: null,
      importedBrokerRowId: null,
      createdAt: new Date(),
    };

    await assertValidLedgerForAsset(input.assetId, {
      draftTransaction,
    });

    const transaction = await prisma.transaction.create({
      data: {
        assetId: input.assetId,
        type: input.type as TransactionType,
        quantity: input.quantity,
        price: input.price,
        fee: input.fee,
        occurredAt: input.occurredAt,
        note: input.note,
      },
      include: { asset: true },
    });

    res.status(201).json({ data: serializeTransaction(transaction) });
  }),
);

transactionsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const transactionId = String(req.params.id);

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { asset: true },
    });

    if (!transaction) {
      throw new AppError(404, "TRANSACTION_NOT_FOUND", "Transaction not found");
    }

    res.json({ data: serializeTransaction(transaction) });
  }),
);

transactionsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const transactionId = String(req.params.id);
    const input = parseWithSchema(updateTransactionSchema, req.body);

    const existingTransaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!existingTransaction) {
      throw new AppError(404, "TRANSACTION_NOT_FOUND", "Transaction not found");
    }

    const nextAssetId = input.assetId ?? existingTransaction.assetId;

    await ensureAssetExists(nextAssetId);

    const nextTransaction = buildDraftTransaction(existingTransaction, {
      assetId: nextAssetId,
      type: (input.type as TransactionType | undefined) ?? existingTransaction.type,
      quantity:
        input.quantity !== undefined
          ? new Prisma.Decimal(input.quantity)
          : existingTransaction.quantity,
      price:
        input.price !== undefined ? new Prisma.Decimal(input.price) : existingTransaction.price,
      fee: input.fee !== undefined ? new Prisma.Decimal(input.fee) : existingTransaction.fee,
      occurredAt: input.occurredAt ?? existingTransaction.occurredAt,
      note: input.note !== undefined ? input.note : existingTransaction.note,
    });

    if (existingTransaction.assetId === nextAssetId) {
      await assertValidLedgerForAsset(nextAssetId, {
        draftTransaction: nextTransaction,
        excludeTransactionId: existingTransaction.id,
      });
    } else {
      await assertValidLedgerForAsset(existingTransaction.assetId, {
        excludeTransactionId: existingTransaction.id,
      });
      await assertValidLedgerForAsset(nextAssetId, {
        draftTransaction: nextTransaction,
      });
    }

    const transaction = await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        assetId: nextAssetId,
        type: nextTransaction.type,
        quantity: nextTransaction.quantity,
        price: nextTransaction.price,
        fee: nextTransaction.fee,
        occurredAt: nextTransaction.occurredAt,
        note: nextTransaction.note,
      },
      include: { asset: true },
    });

    res.json({ data: serializeTransaction(transaction) });
  }),
);

transactionsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const transactionId = String(req.params.id);

    const existingTransaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!existingTransaction) {
      throw new AppError(404, "TRANSACTION_NOT_FOUND", "Transaction not found");
    }

    await assertValidLedgerForAsset(existingTransaction.assetId, {
      excludeTransactionId: existingTransaction.id,
    });

    await prisma.transaction.delete({
      where: { id: transactionId },
    });

    res.status(204).send();
  }),
);
