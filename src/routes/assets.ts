import { Prisma } from "@prisma/client";
import { Router } from "express";

import { AppError, asyncHandler, isUniqueConstraintError } from "../lib/errors";
import { toNumber, toOptionalMarketPrice } from "../lib/portfolio";
import { prisma } from "../lib/prisma";
import { parseWithSchema } from "../lib/validation";
import { createAssetSchema, updateAssetSchema } from "../schemas/assets";

export const assetsRouter = Router();

function serializeAsset(asset: {
  id: string;
  symbol: string;
  name: string;
  currency: string;
  assetClass: string;
  portfolioEligible: boolean;
  currentPrice: Prisma.Decimal;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...asset,
    currentPrice: toOptionalMarketPrice(asset.currentPrice),
  };
}

assetsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const assets = await prisma.asset.findMany({
      orderBy: [{ symbol: "asc" }],
    });

    res.json({ data: assets.map(serializeAsset) });
  }),
);

assetsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parseWithSchema(createAssetSchema, req.body);

    try {
      const asset = await prisma.asset.create({
        data: input,
      });

      res.status(201).json({ data: serializeAsset(asset) });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AppError(409, "ASSET_EXISTS", "An asset with this symbol already exists");
      }

      throw error;
    }
  }),
);

assetsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const assetId = String(req.params.id);

    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      throw new AppError(404, "ASSET_NOT_FOUND", "Asset not found");
    }

    res.json({ data: serializeAsset(asset) });
  }),
);

assetsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const assetId = String(req.params.id);
    const input = parseWithSchema(updateAssetSchema, req.body);

    try {
      const asset = await prisma.asset.update({
        where: { id: assetId },
        data: input,
      });

      res.json({ data: serializeAsset(asset) });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new AppError(404, "ASSET_NOT_FOUND", "Asset not found");
      }

      if (isUniqueConstraintError(error)) {
        throw new AppError(409, "ASSET_EXISTS", "An asset with this symbol already exists");
      }

      throw error;
    }
  }),
);

assetsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const assetId = String(req.params.id);

    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      throw new AppError(404, "ASSET_NOT_FOUND", "Asset not found");
    }

    const transactionCount = await prisma.transaction.count({
      where: { assetId },
    });

    if (transactionCount > 0) {
      throw new AppError(
        409,
        "ASSET_HAS_TRANSACTIONS",
        "Cannot delete an asset with transaction history",
      );
    }

    await prisma.asset.delete({
      where: { id: assetId },
    });

    res.status(204).send();
  }),
);
