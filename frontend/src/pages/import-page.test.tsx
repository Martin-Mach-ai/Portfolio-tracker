import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImportPage } from "./import-page";
import { renderWithProviders } from "../test/render";
import * as api from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");

  return {
    ...actual,
    previewImport: vi.fn(),
    commitImport: vi.fn(),
  };
});

describe("ImportPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("submits the selected broker and renders the detected preview", async () => {
    const user = userEvent.setup();

    vi.mocked(api.previewImport).mockResolvedValue({
      fileName: "trading212.csv",
      broker: "TRADING212",
      items: [
        {
          broker: "TRADING212",
          sourceRow: 2,
          externalId: "T212-1",
          symbol: "AAPL",
          currency: "USD",
          occurredAt: "2025-01-10T09:00:00.000Z",
          type: "BUY",
          quantity: 2,
          price: 190,
          fee: 1,
          fingerprint: "fp-1",
          rowType: "Buy",
          status: "ready",
          issues: [],
        },
      ],
      transactions: [
        {
          broker: "TRADING212",
          externalId: "T212-1",
          symbol: "AAPL",
          currency: "USD",
          date: "2025-01-10T09:00:00.000Z",
          type: "BUY",
          quantity: 2,
          price: 190,
          fee: 1,
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
    });

    renderWithProviders(<ImportPage />);

    await user.selectOptions(screen.getByLabelText("Broker"), "TRADING212");
    await user.upload(
      screen.getByLabelText(/vyber report brokera/i),
      new File(["csv"], "trading212.csv", { type: "text/csv" }),
    );
    await user.click(screen.getByRole("button", { name: /hled importu/i }));

    expect(api.previewImport).toHaveBeenCalledWith(expect.any(File), "TRADING212");
    expect((await screen.findAllByText(/TRADING212/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("AAPL").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /potvrdit import/i })).toBeEnabled();
  });

  it("renders open XTB positions in the preview even when they have no issues", async () => {
    const user = userEvent.setup();

    vi.mocked(api.previewImport).mockResolvedValue({
      fileName: "xtb-open-positions.xlsx",
      broker: "XTB",
      items: [
        {
          broker: "XTB",
          source: "POSITION_TABLE",
          sourceRow: 5,
          externalId: "9101",
          symbol: "AAPL.US",
          currency: "USD",
          assetClass: "STOCK",
          portfolioEligible: true,
          exclusionReason: null,
          category: "STOCK",
          positionState: "OPEN",
          direction: "BUY",
          openTime: "2025-01-10T09:00:00.000Z",
          closeTime: null,
          volume: 2,
          openPrice: 190,
          closePrice: null,
          profit: null,
          status: "ready",
          issues: [],
        },
      ],
      transactions: [
        {
          broker: "XTB",
          externalId: "9101",
          symbol: "AAPL.US",
          currency: "USD",
          date: "2025-01-10T09:00:00.000Z",
          type: "BUY",
          quantity: 2,
          price: 190,
          fee: 0,
          leg: "OPEN",
          portfolioEligible: true,
          exclusionReason: null,
          status: "ready",
        },
      ],
      summary: {
        itemCount: 1,
        readyCount: 1,
        includedCount: 1,
        excludedCount: 0,
        duplicateCount: 0,
        invalidCount: 0,
        transactionCount: 1,
      },
    });

    renderWithProviders(<ImportPage />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Broker" }), "XTB");
    await user.upload(
      screen.getByLabelText(/vyber report brokera/i),
      new File(["xlsx"], "xtb-open-positions.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    await user.click(screen.getByRole("button", { name: /hled importu/i }));

    expect(await screen.findByRole("heading", { name: /pozice, kter/i })).toBeInTheDocument();
    expect(screen.getAllByText("AAPL.US").length).toBeGreaterThan(0);
    expect(screen.getAllByText("OPEN").length).toBeGreaterThan(0);
    expect(screen.getByText(/nebyly nalezeny/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /potvrdit import/i })).toBeEnabled();
  });

  it("keeps confirm disabled and explains why when preview has no ready rows", async () => {
    const user = userEvent.setup();

    vi.mocked(api.previewImport).mockResolvedValue({
      fileName: "xtb-report.xlsx",
      broker: "XTB",
      items: [
        {
          broker: "XTB",
          source: "POSITION_TABLE",
          sourceRow: 6,
          externalId: "1001",
          symbol: "TSLA.US",
          currency: "USD",
          assetClass: "STOCK",
          portfolioEligible: false,
          exclusionReason: "Short or sell-first XTB positions are imported only for audit and excluded from portfolio metrics",
          category: "STOCK",
          positionState: "CLOSED",
          direction: "SELL",
          openTime: "2025-01-10T09:00:00.000Z",
          closeTime: "2025-01-10T10:00:00.000Z",
          volume: 1,
          openPrice: 300,
          closePrice: 290,
          profit: -10,
          status: "invalid",
          issues: [
            {
              code: "UNSUPPORTED_DIRECTION",
              message: "Short or sell-first XTB positions are unsupported and excluded from portfolio imports",
            },
          ],
        },
      ],
      transactions: [],
      summary: {
        itemCount: 1,
        readyCount: 0,
        includedCount: 0,
        excludedCount: 1,
        duplicateCount: 0,
        invalidCount: 1,
        transactionCount: 0,
      },
    });

    renderWithProviders(<ImportPage />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Broker" }), "XTB");
    await user.upload(
      screen.getByLabelText(/vyber report brokera/i),
      new File(["xlsx"], "xtb-report.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    await user.click(screen.getByRole("button", { name: /hled importu/i }));

    expect(screen.getByRole("button", { name: /potvrdit import/i })).toBeDisabled();
    expect(await screen.findByText(/0 p.*ipraven.*ch .*dk.*\./i)).toBeInTheDocument();
  });

  it("commits only ready rows from the preview", async () => {
    const user = userEvent.setup();

    vi.mocked(api.previewImport).mockResolvedValue({
      fileName: "trading212.csv",
      broker: "TRADING212",
      items: [
        {
          broker: "TRADING212",
          sourceRow: 2,
          externalId: "T212-1",
          symbol: "AAPL",
          currency: "USD",
          occurredAt: "2025-01-10T09:00:00.000Z",
          type: "BUY",
          quantity: 2,
          price: 190,
          fee: 1,
          fingerprint: "fp-1",
          rowType: "Buy",
          status: "ready",
          issues: [],
        },
        {
          broker: "TRADING212",
          sourceRow: 3,
          externalId: null,
          symbol: "AAPL",
          currency: "USD",
          occurredAt: "2025-01-11T09:00:00.000Z",
          type: null,
          quantity: null,
          price: null,
          fee: null,
          fingerprint: "fp-2",
          rowType: "Dividend (Dividend)",
          status: "invalid",
          issues: [
            {
              code: "UNSUPPORTED_ROW_TYPE",
              message: "Unsupported row type",
            },
          ],
        },
      ],
      transactions: [
        {
          broker: "TRADING212",
          externalId: "T212-1",
          symbol: "AAPL",
          currency: "USD",
          date: "2025-01-10T09:00:00.000Z",
          type: "BUY",
          quantity: 2,
          price: 190,
          fee: 1,
          status: "ready",
        },
      ],
      summary: {
        itemCount: 2,
        readyCount: 1,
        duplicateCount: 0,
        invalidCount: 1,
        transactionCount: 1,
      },
    });
    vi.mocked(api.commitImport).mockResolvedValue({
      broker: "TRADING212",
      importedItemCount: 1,
      transactionCount: 1,
    });

    renderWithProviders(<ImportPage />);

    await user.selectOptions(screen.getByLabelText("Broker"), "TRADING212");
    await user.upload(
      screen.getByLabelText(/vyber report brokera/i),
      new File(["csv"], "trading212.csv", { type: "text/csv" }),
    );
    await user.click(screen.getByRole("button", { name: /hled importu/i }));
    await user.click(await screen.findByRole("button", { name: /potvrdit import/i }));

    expect(api.commitImport).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.commitImport).mock.calls[0]?.[0]).toEqual({
      broker: "TRADING212",
      items: [
        expect.objectContaining({
          externalId: "T212-1",
          status: "ready",
        }),
      ],
    });
  });
});
