import { AppError } from "../errors";

export type LlmProviderName = "openai";

export type LlmConfig = {
  provider: LlmProviderName;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  baseUrl: string;
};

function readStringEnv(env: NodeJS.ProcessEnv, name: string, fallback?: string): string {
  const value = env[name]?.trim() ?? fallback;

  if (!value) {
    throw new AppError(503, "LLM_CONFIGURATION_ERROR", `Missing required environment variable ${name}`);
  }

  return value;
}

function readNumberEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  options?: { min?: number; max?: number },
): number {
  const rawValue = env[name]?.trim();

  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number(rawValue);

  if (!Number.isFinite(parsedValue)) {
    throw new AppError(503, "LLM_CONFIGURATION_ERROR", `Environment variable ${name} must be a valid number`);
  }

  if (options?.min !== undefined && parsedValue < options.min) {
    throw new AppError(
      503,
      "LLM_CONFIGURATION_ERROR",
      `Environment variable ${name} must be greater than or equal to ${options.min}`,
    );
  }

  if (options?.max !== undefined && parsedValue > options.max) {
    throw new AppError(
      503,
      "LLM_CONFIGURATION_ERROR",
      `Environment variable ${name} must be less than or equal to ${options.max}`,
    );
  }

  return parsedValue;
}

export function resolveLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const provider = (env.LLM_PROVIDER?.trim().toLowerCase() || "openai") as LlmProviderName;

  if (provider !== "openai") {
    throw new AppError(503, "LLM_CONFIGURATION_ERROR", `Unsupported LLM provider "${provider}"`);
  }

  return {
    provider,
    apiKey: readStringEnv(env, "OPENAI_API_KEY"),
    model: readStringEnv(env, "OPENAI_MODEL", "gpt-4.1-mini"),
    temperature: readNumberEnv(env, "OPENAI_TEMPERATURE", 0.2, { min: 0, max: 2 }),
    maxTokens: readNumberEnv(env, "OPENAI_MAX_TOKENS", 512, { min: 1 }),
    timeoutMs: readNumberEnv(env, "LLM_REQUEST_TIMEOUT_MS", 30_000, { min: 1 }),
    baseUrl: readStringEnv(env, "OPENAI_BASE_URL", "https://api.openai.com/v1"),
  };
}
