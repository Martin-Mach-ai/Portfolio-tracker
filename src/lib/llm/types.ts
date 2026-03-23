export type LlmChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type LlmGenerateTextParams = {
  prompt: string;
  systemPrompt?: string;
  messages?: LlmChatMessage[];
  temperature?: number;
  maxTokens?: number;
};

export type LlmUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type LlmGenerateTextResult = {
  provider: string;
  model: string;
  text: string;
  finishReason: string | null;
  usage: LlmUsage;
};

export interface LlmProvider {
  readonly providerName: string;
  readonly model: string;
  generateText(params: LlmGenerateTextParams): Promise<LlmGenerateTextResult>;
}

export interface LlmService {
  generateText(params: LlmGenerateTextParams): Promise<LlmGenerateTextResult>;
}
