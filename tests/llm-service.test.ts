import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../src/lib/errors";
import { createLlmService, resetLlmServiceForTests } from "../src/lib/llm";

describe("LLM service", () => {
  afterEach(() => {
    resetLlmServiceForTests();
    vi.restoreAllMocks();
  });

  it("reads OpenAI configuration from environment variables", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: "Generated answer",
        status: "completed",
        usage: {
          input_tokens: 12,
          output_tokens: 8,
          total_tokens: 20,
        },
      }),
    });

    const service = createLlmService(
      {
        LLM_PROVIDER: "openai",
        LLM_API_KEY: "test-key",
        LLM_MODEL: "gpt-4o-mini",
        LLM_TEMPERATURE: "0.7",
        LLM_MAX_TOKENS: "1024",
        OPENAI_BASE_URL: "https://example.test/v1",
        LLM_REQUEST_TIMEOUT_MS: "1000",
      },
      {
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    );

    const result = await service.generateText({
      prompt: "Summarize the portfolio",
      systemPrompt: "You are a portfolio assistant",
    });

    expect(result.text).toBe("Generated answer");
    expect(result.model).toBe("gpt-4o-mini");
    expect(result.usage.totalTokens).toBe(20);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/v1/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      }),
    );

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(requestInit.body)) as {
      model: string;
      temperature: number;
      max_output_tokens: number;
    };

    expect(payload.model).toBe("gpt-4o-mini");
    expect(payload.temperature).toBe(0.7);
    expect(payload.max_output_tokens).toBe(1024);
  });

  it("throws a configuration error when the API key is missing", async () => {
    expect(() =>
      createLlmService({
        LLM_MODEL: "gpt-4o-mini",
      }),
    ).toThrowError(AppError);

    expect(() =>
      createLlmService({
        LLM_MODEL: "gpt-4o-mini",
      }),
    ).toThrowError(/LLM_API_KEY|OPENAI_API_KEY/);
  });

  it("wraps OpenAI API failures in application errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        error: {
          message: "Rate limit exceeded",
        },
      }),
    });

    const service = createLlmService(
      {
        LLM_API_KEY: "test-key",
        LLM_MODEL: "gpt-4o-mini",
      },
      {
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    );

    await expect(
      service.generateText({
        prompt: "Explain the latest holdings summary",
      }),
    ).rejects.toMatchObject({
      code: "LLM_PROVIDER_ERROR",
      message: "Rate limit exceeded",
    });
  });
});
