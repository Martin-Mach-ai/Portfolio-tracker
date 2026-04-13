import { Broker, TransactionType } from "@prisma/client";
import { z } from "zod";

export const importIssueCodeSchema = z.enum([
  "DUPLICATE_IN_DB",
  "DUPLICATE_IN_FILE",
  "CURRENCY_MISMATCH",
  "UNSUPPORTED_DIRECTION",
  "EXCLUDED_FROM_PORTFOLIO",
  "UNSUPPORTED_ROW_TYPE",
  "MISSING_REQUIRED_FIELD",
  "INVALID_NUMBER",
  "INVALID_DATE",
]);

const previewIssueSchema = z.object({
  code: importIssueCodeSchema,
  message: z.string().trim().min(1),
});

const importStatusSchema = z.enum(["ready", "duplicate", "invalid"]);

export const brokerSchema = z.nativeEnum(Broker);

const baseImportItemSchema = z.object({
  sourceRow: z.coerce.number().int().positive(),
  broker: brokerSchema,
  externalId: z.string().trim().min(1).nullable().optional(),
  symbol: z.string().trim().min(1),
  currency: z.string().trim().min(1),
  status: importStatusSchema,
  issues: z.array(previewIssueSchema),
});

export const xtbImportItemSchema = baseImportItemSchema.extend({
  broker: z.literal(Broker.XTB),
  source: z.enum(["POSITION_TABLE", "CASH_OPERATION"]),
  externalId: z.string().trim().min(1),
  assetClass: z.enum(["STOCK", "ETF", "CFD", "CRYPTO", "FOREX", "UNKNOWN"]),
  portfolioEligible: z.coerce.boolean(),
  exclusionReason: z.string().trim().min(1).nullable().optional(),
  category: z.string().trim().min(1).nullable().optional(),
  positionState: z.enum(["OPEN", "CLOSED"]),
  direction: z.nativeEnum(TransactionType),
  openTime: z.coerce.date(),
  closeTime: z.coerce.date().nullable(),
  volume: z.coerce.number().positive(),
  openPrice: z.coerce.number().finite().min(0),
  closePrice: z.coerce.number().finite().min(0).nullable(),
  profit: z.coerce.number().finite().nullable(),
});

export const trading212ImportItemSchema = baseImportItemSchema.extend({
  broker: z.literal(Broker.TRADING212),
  occurredAt: z.coerce.date().nullable(),
  type: z.nativeEnum(TransactionType).nullable(),
  quantity: z.coerce.number().positive().nullable(),
  price: z.coerce.number().finite().min(0).nullable(),
  fee: z.coerce.number().finite().min(0).nullable(),
  fingerprint: z.string().trim().min(1),
  rowType: z.string().trim().min(1),
});

export const importItemSchema = z.union([xtbImportItemSchema, trading212ImportItemSchema]);

export const commitImportSchema = z.object({
  broker: brokerSchema,
  items: z.array(importItemSchema),
});

export type CommitImportInput = z.infer<typeof commitImportSchema>;
export type XtbImportItemInput = z.infer<typeof xtbImportItemSchema>;
export type Trading212ImportItemInput = z.infer<typeof trading212ImportItemSchema>;
