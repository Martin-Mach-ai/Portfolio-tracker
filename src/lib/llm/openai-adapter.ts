import { AppError } from "../errors";
import type {
  LlmChatMessage,
  LlmGenerateTextParams,
  LlmGenerateTextResult,
  LlmProvider,
  LlmUsage,
} from "./types";

type OpenAiAdapterConfig = {
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

type OpenAiResponsesApiResponse = {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  status?: string;
  incomplete_details?: {
    reason?: string;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

type OpenAiInputMessage = {
  role: "user" | "assistant";
  content: Array<{
    type: "input_text";
    text: string;
  }>;
};

function buildUsage(usage: OpenAiResponsesApiResponse["usage"]): LlmUsage {
  return {
    inputTokens: usage?.input_tokens ?? null,
    outputTokens: usage?.output_tokens ?? null,
    totalTokens: usage?.total_tokens ?? null,
  };
}

function extractOutputText(payload: OpenAiResponsesApiResponse): string | null {
  if (typeof payload.output_text === "string" && payload.output_text.trim().length > 0) {
    return payload.output_text.trim();
  }

  for (const outputItem of payload.output ?? []) {
    for (const contentItem of outputItem.content ?? []) {
      if (contentItem.type === "output_text" && typeof contentItem.text === "string" && contentItem.text.trim()) {
        return contentItem.text.trim();
      }
    }
  }

  return null;
}

function toOpenAiInputMessages(messages: LlmChatMessage[]): OpenAiInputMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: [
      {
        type: "input_text",
        text: message.content,
      },
    ],
  }));
}

export class OpenAiLlmAdapter implements LlmProvider {
  readonly providerName = "openai";
  readonly model: string;

  private readonly apiKey: string;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OpenAiAdapterConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.temperature = config.temperature;
    this.maxTokens = config.maxTokens;
    this.timeoutMs = config.timeoutMs;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async generateText(params: LlmGenerateTextParams): Promise<LlmGenerateTextResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: params.temperature ?? this.temperature,
          max_output_tokens: params.maxTokens ?? this.maxTokens,
          instructions: params.systemPrompt,
          input: toOpenAiInputMessages(
            params.messages && params.messages.length > 0
              ? params.messages
              : [
                  {
                    role: "user",
                    content: params.prompt,
                  },
                ],
          ),
        }),
        signal: controller.signal,
      });

      const payload = (await response.json().catch(() => null)) as OpenAiResponsesApiResponse | null;

      if (!response.ok) {
        throw new AppError(
          502,
          "LLM_PROVIDER_ERROR",
          payload?.error?.message || `OpenAI request failed with status ${response.status}`,
          payload,
        );
      }

      if (!payload) {
        throw new AppError(502, "LLM_INVALID_RESPONSE", "OpenAI returned an empty response body");
      }

      const text = extractOutputText(payload);

      if (!text) {
        throw new AppError(502, "LLM_INVALID_RESPONSE", "OpenAI response did not contain any output text", payload);
      }

      return {
        provider: this.providerName,
        model: this.model,
        text,
        finishReason: payload.incomplete_details?.reason ?? payload.status ?? null,
        usage: buildUsage(payload.usage),
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError(504, "LLM_TIMEOUT", "The LLM provider did not respond before the request timed out");
      }

      throw new AppError(502, "LLM_PROVIDER_ERROR", "Failed to reach the configured LLM provider", {
        cause: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
