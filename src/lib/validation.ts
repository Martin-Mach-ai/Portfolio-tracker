import { ZodError, type ZodType } from "zod";

import { AppError } from "./errors";

export function parseWithSchema<T>(schema: ZodType<T>, input: unknown): T {
  try {
    return schema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid request data", error.flatten());
    }

    throw error;
  }
}
