import { z } from "zod";

const datetimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export const assetFormSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1, "Symbol is required")
    .max(12)
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1, "Name is required").max(120),
  currency: z
    .string()
    .trim()
    .length(3, "Currency must be a 3-letter code")
    .transform((value) => value.toUpperCase()),
  currentPrice: z.coerce.number().finite().min(0, "Current price must be 0 or more"),
});

export type AssetFormValues = z.output<typeof assetFormSchema>;

export const transactionFormSchema = z.object({
  assetId: z.string().trim().min(1, "Asset is required"),
  type: z.enum(["BUY", "SELL"]),
  quantity: z.coerce.number().finite().positive("Quantity must be greater than 0"),
  price: z.coerce.number().finite().min(0, "Price must be 0 or more"),
  fee: z.coerce.number().finite().min(0, "Fee must be 0 or more"),
  occurredAt: z
    .string()
    .trim()
    .refine((value) => datetimePattern.test(value), "Date and time are required")
    .transform((value) => new Date(value).toISOString()),
  note: z
    .string()
    .trim()
    .max(500, "Note must be 500 characters or fewer")
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export type TransactionFormInput = z.input<typeof transactionFormSchema>;
export type TransactionFormValues = z.output<typeof transactionFormSchema>;

export function toDateTimeLocalValue(value?: string): string {
  const date = value ? new Date(value) : new Date();
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}
