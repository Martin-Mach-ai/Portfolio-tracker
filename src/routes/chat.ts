import { Router } from "express";

import { getChatbotInstructions } from "../lib/chatbot/instructions";
import { asyncHandler } from "../lib/errors";
import { getLlmService } from "../lib/llm";
import { parseWithSchema } from "../lib/validation";
import { chatRequestSchema } from "../schemas/chat";

export const chatRouter = Router();

chatRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parseWithSchema(chatRequestSchema, req.body);
    const llmService = getLlmService();
    const reply = await llmService.generateText({
      prompt: input.message,
      systemPrompt: getChatbotInstructions(),
      messages: [
        ...(input.history ?? []),
        {
          role: "user",
          content: input.message,
        },
      ],
    });

    res.json({
      data: {
        message: {
          role: "assistant" as const,
          content: reply.text,
        },
        provider: reply.provider,
        model: reply.model,
        finishReason: reply.finishReason,
        usage: reply.usage,
      },
    });
  }),
);
