import { z } from "zod";

const uppercaseString = (min: number, max: number) =>
  z.string().trim().min(min).max(max).transform((value) => value.toUpperCase());

const assetClassSchema = z.enum(["STOCK", "ETF", "CFD", "CRYPTO", "FOREX", "UNKNOWN"]);

export const createAssetSchema = z.object({
  symbol: uppercaseString(1, 12),
  name: z.string().trim().min(1).max(120),
  currency: uppercaseString(3, 3),
  assetClass: assetClassSchema.default("UNKNOWN"),
  portfolioEligible: z.coerce.boolean().default(true),
  currentPrice: z.coerce.number().finite().min(0),
});

export const updateAssetSchema = createAssetSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });
