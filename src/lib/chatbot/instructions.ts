import { readFileSync } from "node:fs";
import path from "node:path";

import { AppError } from "../errors";

const chatbotInstructionsPath = path.resolve(process.cwd(), "backend", "chatbot-instructions.md");

function loadChatbotInstructions(): string {
  try {
    const fileContents = readFileSync(chatbotInstructionsPath, "utf8").trim();

    if (!fileContents) {
      throw new AppError(500, "CHATBOT_CONFIGURATION_ERROR", "Chatbot instructions file is empty");
    }

    return fileContents;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      500,
      "CHATBOT_CONFIGURATION_ERROR",
      "Chatbot instructions could not be loaded at startup",
      {
        path: chatbotInstructionsPath,
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

const chatbotInstructions = loadChatbotInstructions();

export function getChatbotInstructions(): string {
  return chatbotInstructions;
}

export function getChatbotInstructionsPath(): string {
  return chatbotInstructionsPath;
}
