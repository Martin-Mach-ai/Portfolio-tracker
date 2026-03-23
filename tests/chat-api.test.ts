import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateTextMock = vi.fn();

vi.mock("../src/lib/llm", () => ({
  getLlmService: () => ({
    generateText: generateTextMock,
  }),
}));

describe("chat API", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
  });

  it("accepts a user message with client-provided history and returns an assistant reply", async () => {
    generateTextMock.mockResolvedValue({
      provider: "openai",
      model: "gpt-4o-mini",
      text: "V aplikaci otevřete sekci Import a spusťte náhled importu.",
      finishReason: "completed",
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
      },
    });

    const { app } = await import("../src/app");

    const response = await request(app).post("/api/chat").send({
      message: "Jak nahraju XTB export?",
      history: [
        {
          role: "user",
          content: "Ahoj",
        },
        {
          role: "assistant",
          content: "Dobrý den, jak mohu pomoci?",
        },
      ],
    });

    expect(response.status).toBe(200);
    expect(response.body.data.message.role).toBe("assistant");
    expect(response.body.data.message.content).toContain("Import");
    expect(response.body.data.model).toBe("gpt-4o-mini");
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Jak nahraju XTB export?",
        messages: [
          { role: "user", content: "Ahoj" },
          { role: "assistant", content: "Dobrý den, jak mohu pomoci?" },
          { role: "user", content: "Jak nahraju XTB export?" },
        ],
        systemPrompt: expect.stringContaining("Portfolio Asistent"),
      }),
    );
  });

  it("rejects invalid chat requests", async () => {
    const { app } = await import("../src/app");

    const response = await request(app).post("/api/chat").send({
      message: "",
      history: [{ role: "system", content: "hack" }],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.message).toBe("Invalid request data");
  });
});
