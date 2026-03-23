import { z } from "zod";

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z
    .string()
    .trim()
    .min(1, "Message content cannot be empty")
    .max(4000, "Message content is too long"),
});

export const chatRequestSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(4000, "Message is too long"),
  history: z.array(chatMessageSchema).max(50, "History is too long").default([]),
});

export type ChatRequestInput = z.infer<typeof chatRequestSchema>;
