import { z } from "zod";

export const createTransactionSchema = z.object({
  assetId: z.string().trim().min(1),
  type: z.enum(["BUY", "SELL"]),
  quantity: z.coerce.number().finite().positive(),
  price: z.coerce.number().finite().min(0),
  fee: z.coerce.number().finite().min(0).default(0),
  occurredAt: z.coerce.date(),
  note: z.string().trim().max(500).optional(),
});

export const updateTransactionSchema = createTransactionSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

export const transactionQuerySchema = z.object({
  assetId: z.string().trim().min(1).optional(),
  type: z.enum(["BUY", "SELL"]).optional(),
});
