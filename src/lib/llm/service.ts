import { resolveLlmConfig } from "./config";
import { OpenAiLlmAdapter } from "./openai-adapter";
import type { LlmGenerateTextParams, LlmGenerateTextResult, LlmProvider, LlmService } from "./types";

class DefaultLlmService implements LlmService {
  constructor(private readonly provider: LlmProvider) {}

  generateText(params: LlmGenerateTextParams): Promise<LlmGenerateTextResult> {
    return this.provider.generateText(params);
  }
}

export function createLlmService(
  env: NodeJS.ProcessEnv = process.env,
  dependencies?: {
    fetchImpl?: typeof fetch;
  },
): LlmService {
  const config = resolveLlmConfig(env);

  if (config.provider === "openai") {
    return new DefaultLlmService(
      new OpenAiLlmAdapter({
        apiKey: config.apiKey,
        model: config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        timeoutMs: config.timeoutMs,
        baseUrl: config.baseUrl,
        fetchImpl: dependencies?.fetchImpl,
      }),
    );
  }

  return new DefaultLlmService(
    new OpenAiLlmAdapter({
      apiKey: config.apiKey,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      timeoutMs: config.timeoutMs,
      baseUrl: config.baseUrl,
      fetchImpl: dependencies?.fetchImpl,
    }),
  );
}

let cachedLlmService: LlmService | null = null;

export function getLlmService(): LlmService {
  if (!cachedLlmService) {
    cachedLlmService = createLlmService();
  }

  return cachedLlmService;
}

export function resetLlmServiceForTests() {
  cachedLlmService = null;
}
