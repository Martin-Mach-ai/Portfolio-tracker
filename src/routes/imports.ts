import { AssetClass, Broker, Prisma, TransactionType } from "@prisma/client";
import multer from "multer";
import { Router } from "express";

import { AppError, asyncHandler } from "../lib/errors";
import {
  assertSupportedImportExtension,
  readSpreadsheetWorkbook,
  type SpreadsheetWorkbook,
  type Trading212ImportPreviewItem,
} from "../lib/imports";
import { prisma } from "../lib/prisma";
import { buildTrading212LedgerTransaction, buildTrading212Preview, canParseTrading212Rows } from "../lib/trading212";
import { parseWithSchema } from "../lib/validation";
import {
  assertImportedLedgerIsValid,
  buildStoredXtbExternalId,
  extractStoredXtbFingerprint,
  buildXtbPositionFingerprint,
  buildImportedLedgerTransactions,
  buildXtbPreview,
  canParseXtbWorkbook,
  parseXtbWorkbook,
  type ParsedXtbPosition,
} from "../lib/xtb";
import { brokerSchema, commitImportSchema, type Trading212ImportItemInput, type XtbImportItemInput } from "../schemas/imports";

export const importsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

function ensureImportFile(file: Express.Multer.File | undefined): Express.Multer.File {
  if (!file) {
    throw new AppError(400, "IMPORT_FILE_REQUIRED", "A report file is required");
  }

  assertSupportedImportExtension(file.originalname);

  return file;
}

function detectBroker(workbook: SpreadsheetWorkbook, rows: unknown[][]): Broker {
  const xtbMatch = canParseXtbWorkbook(workbook);
  const trading212Match = canParseTrading212Rows(rows);

  if (xtbMatch && trading212Match) {
    throw new AppError(400, "AMBIGUOUS_IMPORT_FORMAT", "The uploaded report matches multiple broker formats");
  }

  if (xtbMatch) {
    return Broker.XTB;
  }

  if (trading212Match) {
    return Broker.TRADING212;
  }

  throw new AppError(400, "UNSUPPORTED_IMPORT_FORMAT", "Unable to detect a supported broker format");
}

async function loadAssetReferenceData(symbols: string[]) {
  const assets = await prisma.asset.findMany({
    where: {
      symbol: {
        in: [...new Set(symbols)],
      },
    },
    select: {
      id: true,
      symbol: true,
      currency: true,
      assetClass: true,
      portfolioEligible: true,
    },
  });

  return new Map(assets.map((asset) => [asset.symbol, asset]));
}

async function loadXtbReferenceData(parsedPositions: ParsedXtbPosition[]) {
  const symbols = parsedPositions.map((position) => position.symbol);
  const [assetsWithTransactions, importedPositions] = await Promise.all([
    prisma.asset.findMany({
      where: {
        symbol: {
          in: [...new Set(symbols)],
        },
      },
      select: {
        id: true,
        symbol: true,
        currency: true,
        assetClass: true,
        portfolioEligible: true,
        transactions: {
          orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            assetId: true,
            type: true,
            quantity: true,
            price: true,
            fee: true,
            occurredAt: true,
            createdAt: true,
          },
        },
      },
    }),
    prisma.importedPosition.findMany({
      where: {
        broker: Broker.XTB,
        symbol: {
          in: [...new Set(symbols)],
        },
      },
      select: {
        externalId: true,
        symbol: true,
        currency: true,
        positionState: true,
        direction: true,
        openTime: true,
        closeTime: true,
        volume: true,
        openPrice: true,
        closePrice: true,
      },
    }),
  ]);

  const existingAssets = new Map(
    assetsWithTransactions.map((asset) => [
      asset.symbol,
      {
        id: asset.id,
        symbol: asset.symbol,
        currency: asset.currency,
        assetClass: asset.assetClass,
        portfolioEligible: asset.portfolioEligible,
      },
    ]),
  );

  return {
    existingAssets,
    existingFingerprints: new Set(
      importedPositions.map((position) =>
        extractStoredXtbFingerprint(position.externalId) ??
        buildXtbPositionFingerprint({
          ...position,
          volume: Number(position.volume),
          openPrice: Number(position.openPrice),
          closePrice: position.closePrice === null ? null : Number(position.closePrice),
        }),
      ),
    ),
    existingTransactionsBySymbol: new Map(
      assetsWithTransactions.map((asset) => [asset.symbol, asset.transactions]),
    ),
  };
}

async function loadTrading212ReferenceData(rows: Trading212ImportPreviewItem[]) {
  const symbols = rows.map((row) => row.symbol);
  const fingerprints = [...new Set(rows.map((row) => row.fingerprint))];
  const [existingAssets, importedRows] = await Promise.all([
    loadAssetReferenceData(symbols),
    prisma.importedBrokerRow.findMany({
      where: {
        broker: Broker.TRADING212,
        fingerprint: {
          in: fingerprints,
        },
      },
      select: {
        fingerprint: true,
      },
    }),
  ]);

  return {
    existingAssets,
    existingFingerprints: new Set(importedRows.map((row) => row.fingerprint)),
  };
}

async function resolveOrCreateAsset(
  symbol: string,
  currency: string,
  options?: {
    assetClass?: AssetClass;
    portfolioEligible?: boolean;
  },
) {
  const existingAsset = await prisma.asset.findUnique({
    where: { symbol },
    select: {
      id: true,
      symbol: true,
      currency: true,
      assetClass: true,
      portfolioEligible: true,
    },
  });

  if (existingAsset) {
    if (existingAsset.currency !== currency) {
      throw new AppError(
        409,
        "ASSET_CURRENCY_MISMATCH",
        `Asset ${symbol} already exists with ${existingAsset.currency}, not ${currency}`,
      );
    }

    return existingAsset;
  }

  return prisma.asset.create({
    data: {
      symbol,
      name: symbol,
      currency,
      assetClass: options?.assetClass ?? AssetClass.UNKNOWN,
      portfolioEligible: options?.portfolioEligible ?? true,
      currentPrice: 0,
    },
    select: {
      id: true,
      symbol: true,
      currency: true,
      assetClass: true,
      portfolioEligible: true,
    },
  });
}

async function previewGenericImport(file: Express.Multer.File, requestedBroker?: Broker) {
  const workbook = readSpreadsheetWorkbook(file.buffer);
  const rows = workbook.sheets[0]?.rows ?? [];
  const broker = requestedBroker ?? detectBroker(workbook, rows);

  if (requestedBroker === Broker.XTB && !canParseXtbWorkbook(workbook)) {
    throw new AppError(400, "XTB_PARSE_ERROR", "The uploaded file does not match the XTB report format");
  }

  if (requestedBroker === Broker.TRADING212 && !canParseTrading212Rows(rows)) {
    throw new AppError(
      400,
      "TRADING212_PARSE_ERROR",
      "The uploaded file does not match the Trading212 transaction history format",
    );
  }

  if (broker === Broker.XTB) {
    const parsedPositions = parseXtbWorkbook(file.buffer, { fileName: file.originalname });
    const { existingAssets, existingFingerprints, existingTransactionsBySymbol } = await loadXtbReferenceData(parsedPositions);
    const preview = buildXtbPreview({
      parsedPositions,
      existingAssets,
      existingFingerprints,
      existingTransactionsBySymbol,
    });

    return {
      fileName: file.originalname,
      broker,
      items: preview.positions,
      transactions: preview.transactions,
      summary: {
        itemCount: preview.summary.positionCount,
        readyCount: preview.summary.readyPositionCount,
        includedCount: preview.summary.includedPositionCount,
        excludedCount: preview.summary.excludedPositionCount,
        duplicateCount: preview.summary.duplicateCount,
        invalidCount: preview.summary.invalidCount,
        transactionCount: preview.summary.transactionCount,
      },
    };
  }

  const initialPreview = buildTrading212Preview({
    rows,
    existingFingerprints: new Set(),
    existingAssets: new Map(),
  });
  const { existingAssets, existingFingerprints } = await loadTrading212ReferenceData(initialPreview.items);
  const preview = buildTrading212Preview({
    rows,
    existingFingerprints,
    existingAssets,
  });

  return {
    fileName: file.originalname,
    broker,
    items: preview.items,
    transactions: preview.transactions,
    summary: preview.summary,
  };
}

async function commitXtbImport(items: XtbImportItemInput[]) {
  const readyPositions = items.filter((item) => item.status === "ready");
  const eligiblePositions = readyPositions.filter((item) => item.portfolioEligible);
  const excludedPositions = readyPositions.filter((item) => !item.portfolioEligible);

  if (readyPositions.length === 0) {
    throw new AppError(400, "NO_IMPORTABLE_ROWS", "The preview does not contain any ready XTB rows to import");
  }

  const { existingAssets, existingFingerprints } = await loadXtbReferenceData(
    readyPositions.map((position) => ({
      ...position,
      externalId: position.externalId,
    })),
  );
  const duplicateIds = readyPositions
    .filter((position) => existingFingerprints.has(buildXtbPositionFingerprint(position)))
    .map((position) => position.externalId);

  if (duplicateIds.length > 0) {
    throw new AppError(
      409,
      "XTB_DUPLICATE_IMPORT",
      "One or more XTB positions were already imported",
      { externalIds: duplicateIds },
    );
  }

  const importPlans = new Map<
    string,
    {
      assetId: string;
      drafts: Array<{
        id: string;
        assetId: string;
        type: TransactionType;
        quantity: Prisma.Decimal;
        price: Prisma.Decimal;
        fee: Prisma.Decimal;
        occurredAt: Date;
        createdAt: Date;
      }>;
    }
  >();
  const resolvedAssets = new Map<
    string,
    {
      id: string;
      symbol: string;
      currency: string;
      assetClass: AssetClass;
      portfolioEligible: boolean;
    }
  >();

  for (const position of eligiblePositions) {
    const existingAsset = existingAssets.get(position.symbol);

    if (existingAsset && existingAsset.currency !== position.currency) {
      throw new AppError(
        409,
        "ASSET_CURRENCY_MISMATCH",
        `Asset ${position.symbol} already exists with ${existingAsset.currency}, not ${position.currency}`,
      );
    }

    const asset =
      existingAsset ??
      (await resolveOrCreateAsset(position.symbol, position.currency, {
        assetClass: position.assetClass,
        portfolioEligible: true,
      }));
    resolvedAssets.set(position.symbol, asset);

    const plan = importPlans.get(asset.id) ?? {
      assetId: asset.id,
      drafts: [] as Array<{
        id: string;
        assetId: string;
        type: TransactionType;
        quantity: Prisma.Decimal;
        price: Prisma.Decimal;
        fee: Prisma.Decimal;
        occurredAt: Date;
        createdAt: Date;
      }>,
    };
    const createdAt = new Date();

    for (const transaction of buildImportedLedgerTransactions(position)) {
      plan.drafts.push({
        id: `${position.externalId}-${transaction.importLeg}`,
        assetId: asset.id,
        type: transaction.type,
        quantity: new Prisma.Decimal(transaction.quantity),
        price: new Prisma.Decimal(transaction.price),
        fee: new Prisma.Decimal(transaction.fee),
        occurredAt: transaction.occurredAt,
        createdAt,
      });
    }

    importPlans.set(asset.id, plan);
  }

  for (const plan of importPlans.values()) {
    const existingTransactions = await prisma.transaction.findMany({
      where: { assetId: plan.assetId },
      orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        assetId: true,
        type: true,
        quantity: true,
        price: true,
        fee: true,
        occurredAt: true,
        createdAt: true,
      },
    });

    assertImportedLedgerIsValid({
      existingTransactions,
      importedTransactions: plan.drafts,
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    let createdTransactions = 0;

    for (const position of readyPositions) {
      const importedPosition = await tx.importedPosition.create({
        data: {
          broker: Broker.XTB,
          externalId: buildStoredXtbExternalId(position),
          symbol: position.symbol,
          currency: position.currency,
          assetClass: position.assetClass,
          portfolioEligible: position.portfolioEligible,
          exclusionReason: position.exclusionReason ?? null,
          category: position.category ?? null,
          positionState: position.positionState,
          direction: position.direction,
          openTime: position.openTime,
          closeTime: position.closeTime,
          volume: position.volume,
          openPrice: position.openPrice,
          closePrice: position.closePrice,
          profit: position.profit,
        },
      });

      for (const transaction of buildImportedLedgerTransactions(position)) {
        const asset = resolvedAssets.get(position.symbol);

        if (!asset) {
          throw new AppError(500, "IMPORT_STATE_ERROR", `Resolved asset missing for ${position.symbol}`);
        }

        await tx.transaction.create({
          data: {
            assetId: asset.id,
            type: transaction.type,
            quantity: transaction.quantity,
            price: transaction.price,
            fee: transaction.fee,
            occurredAt: transaction.occurredAt,
            note: transaction.note,
            importLeg: transaction.importLeg,
            importedPositionId: importedPosition.id,
          },
        });

        createdTransactions += 1;
      }
    }

    return {
      importedItemCount: readyPositions.length,
      includedItemCount: eligiblePositions.length,
      excludedItemCount: excludedPositions.length,
      transactionCount: createdTransactions,
    };
  });

  return result;
}

async function commitTrading212Import(items: Trading212ImportItemInput[]) {
  const readyRows = items.filter((item) => item.status === "ready");

  if (readyRows.length === 0) {
    throw new AppError(
      400,
      "NO_IMPORTABLE_ROWS",
      "The preview does not contain any ready Trading212 rows to import",
    );
  }

  const duplicateFingerprints = await prisma.importedBrokerRow.findMany({
    where: {
      broker: Broker.TRADING212,
      fingerprint: {
        in: readyRows.map((row) => row.fingerprint),
      },
    },
    select: {
      fingerprint: true,
    },
  });

  if (duplicateFingerprints.length > 0) {
    throw new AppError(
      409,
      "TRADING212_DUPLICATE_IMPORT",
      "One or more Trading212 rows were already imported",
      { fingerprints: duplicateFingerprints.map((row) => row.fingerprint) },
    );
  }

  const resolvedAssets = new Map<string, { id: string; symbol: string; currency: string }>();
  const importPlans = new Map<
    string,
    {
      assetId: string;
      drafts: Array<{
        id: string;
        assetId: string;
        type: TransactionType;
        quantity: Prisma.Decimal;
        price: Prisma.Decimal;
        fee: Prisma.Decimal;
        occurredAt: Date;
        createdAt: Date;
      }>;
    }
  >();

  for (const row of readyRows) {
    if (!row.occurredAt || !row.type || row.quantity === null || row.price === null || row.fee === null) {
      throw new AppError(
        400,
        "TRADING212_IMPORT_INVALID",
        `Trading212 row ${row.sourceRow} is missing normalized trade values`,
      );
    }

    const asset = resolvedAssets.get(row.symbol) ?? (await resolveOrCreateAsset(row.symbol, row.currency));
    resolvedAssets.set(row.symbol, asset);

    const plan = importPlans.get(asset.id) ?? {
      assetId: asset.id,
      drafts: [] as Array<{
        id: string;
        assetId: string;
        type: TransactionType;
        quantity: Prisma.Decimal;
        price: Prisma.Decimal;
        fee: Prisma.Decimal;
        occurredAt: Date;
        createdAt: Date;
      }>,
    };

    const transaction = buildTrading212LedgerTransaction(row);

    plan.drafts.push({
      id: row.fingerprint,
      assetId: asset.id,
      type: transaction.type,
      quantity: new Prisma.Decimal(transaction.quantity),
      price: new Prisma.Decimal(transaction.price),
      fee: new Prisma.Decimal(transaction.fee),
      occurredAt: transaction.occurredAt,
      createdAt: new Date(),
    });

    importPlans.set(asset.id, plan);
  }

  for (const plan of importPlans.values()) {
    const existingTransactions = await prisma.transaction.findMany({
      where: { assetId: plan.assetId },
      orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        assetId: true,
        type: true,
        quantity: true,
        price: true,
        fee: true,
        occurredAt: true,
        createdAt: true,
      },
    });

    assertImportedLedgerIsValid({
      existingTransactions,
      importedTransactions: plan.drafts,
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    let createdTransactions = 0;

    for (const row of readyRows) {
      const asset = resolvedAssets.get(row.symbol);

      if (!asset) {
        throw new AppError(500, "IMPORT_STATE_ERROR", `Resolved asset missing for ${row.symbol}`);
      }

      const importedBrokerRow = await tx.importedBrokerRow.create({
        data: {
          broker: Broker.TRADING212,
          fingerprint: row.fingerprint,
          externalId: row.externalId ?? null,
          symbol: row.symbol,
          currency: row.currency,
          occurredAt: row.occurredAt!,
          sourceRow: row.sourceRow,
        },
      });
      const transaction = buildTrading212LedgerTransaction(row);

      await tx.transaction.create({
        data: {
          assetId: asset.id,
          type: transaction.type,
          quantity: transaction.quantity,
          price: transaction.price,
          fee: transaction.fee,
          occurredAt: transaction.occurredAt,
          note: transaction.note,
          importedBrokerRowId: importedBrokerRow.id,
        },
      });

      createdTransactions += 1;
    }

    return {
      importedItemCount: readyRows.length,
      transactionCount: createdTransactions,
    };
  });

  return result;
}

const previewImportHandler = asyncHandler(async (req, res) => {
  const file = ensureImportFile(req.file);
  const requestedBroker =
    typeof req.body.broker === "string" && req.body.broker.length > 0
      ? parseWithSchema(brokerSchema, req.body.broker)
      : undefined;
  const preview = await previewGenericImport(file, requestedBroker);

  res.json({ data: preview });
});

importsRouter.post(["/preview", "/prepare"], upload.single("file"), previewImportHandler);

importsRouter.post(
  "/commit",
  asyncHandler(async (req, res) => {
    const input = parseWithSchema(commitImportSchema, req.body);

    if (input.items.some((item) => item.broker !== input.broker)) {
      throw new AppError(400, "VALIDATION_ERROR", "Import items do not match the selected broker");
    }

    const result =
      input.broker === Broker.XTB
        ? await commitXtbImport(input.items as XtbImportItemInput[])
        : await commitTrading212Import(input.items as Trading212ImportItemInput[]);

    res.status(201).json({
      data: {
        broker: input.broker,
        ...result,
      },
    });
  }),
);
