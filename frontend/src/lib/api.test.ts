import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, getHealth, previewImport } from "./api";

describe("api request parsing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a valid import preview envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          data: {
            fileName: "xtb.xlsx",
            broker: "XTB",
            items: [],
            transactions: [
              {
                broker: "XTB",
                symbol: "AAPL.US",
                currency: "USD",
                date: "2025-01-10T09:00:00.000Z",
                type: "BUY",
                quantity: 1,
                price: 190,
                fee: 0,
                externalId: "1",
                leg: "OPEN",
                status: "ready",
              },
            ],
            summary: {
              itemCount: 1,
              readyCount: 1,
              duplicateCount: 0,
              invalidCount: 0,
              transactionCount: 1,
            },
          },
        }),
      ),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await previewImport(new File(["test"], "xtb.xlsx"));

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]?.symbol).toBe("AAPL.US");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/imports/preview",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("throws a controlled ApiError when the server returns invalid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(""),
      }),
    );

    await expect(previewImport(new File(["test"], "xtb.xlsx"))).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      message: "Server returned an empty response body",
    } satisfies Partial<ApiError>);
  });

  it("parses the plain health response from the backend", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify({ status: "ok" })),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getHealth()).resolves.toEqual({ status: "ok" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/health",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });
});
