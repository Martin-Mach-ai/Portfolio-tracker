import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionsPage } from "./transactions-page";
import { ApiError } from "../lib/api";
import { renderWithProviders } from "../test/render";
import * as api from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");

  return {
    ...actual,
    getAssets: vi.fn(),
    getTransactions: vi.fn(),
    createTransaction: vi.fn(),
    updateTransaction: vi.fn(),
    deleteTransaction: vi.fn(),
  };
});

describe("TransactionsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows ledger validation errors from the API", async () => {
    const user = userEvent.setup();

    vi.mocked(api.getAssets).mockResolvedValue([
      {
        id: "asset-1",
        symbol: "BTC",
        name: "Bitcoin",
        currency: "USD",
        assetClass: "CRYPTO",
        portfolioEligible: false,
        currentPrice: 45000,
        createdAt: "",
        updatedAt: "",
      },
    ]);
    vi.mocked(api.getTransactions).mockResolvedValue([]);
    vi.mocked(api.createTransaction).mockRejectedValue(
      new ApiError(422, "INVALID_LEDGER", "Transaction would sell more units than currently owned"),
    );

    renderWithProviders(<TransactionsPage />);

    await screen.findByText("Pro tento filtr nejsou žádné transakce");
    await user.click(screen.getByRole("button", { name: "Přidat transakci" }));
    const dialog = screen.getByRole("dialog");

    await user.selectOptions(within(dialog).getByLabelText("Typ"), "SELL");
    await user.clear(within(dialog).getByLabelText("Množství"));
    await user.type(within(dialog).getByLabelText("Množství"), "2");
    await user.clear(within(dialog).getByLabelText("Cena"));
    await user.type(within(dialog).getByLabelText("Cena"), "45000");
    await user.clear(within(dialog).getByLabelText("Datum a čas"));
    await user.type(within(dialog).getByLabelText("Datum a čas"), "2025-01-10T10:00");
    await user.click(within(dialog).getByRole("button", { name: "Vytvořit transakci" }));

    expect(
      await screen.findByText("Transaction would sell more units than currently owned"),
    ).toBeInTheDocument();
  });

  it("filters and sorts transactions in the table", async () => {
    const user = userEvent.setup();

    vi.mocked(api.getAssets).mockResolvedValue([
      {
        id: "asset-btc",
        symbol: "BTC",
        name: "Bitcoin",
        currency: "USD",
        assetClass: "CRYPTO",
        portfolioEligible: true,
        currentPrice: 45000,
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "asset-tsla",
        symbol: "TSLA",
        name: "Tesla",
        currency: "USD",
        assetClass: "STOCK",
        portfolioEligible: true,
        currentPrice: 300,
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "asset-cez",
        symbol: "CEZ",
        name: "ČEZ",
        currency: "CZK",
        assetClass: "STOCK",
        portfolioEligible: true,
        currentPrice: 1100,
        createdAt: "",
        updatedAt: "",
      },
    ]);
    vi.mocked(api.getTransactions).mockResolvedValue([
      {
        id: "tx-btc",
        assetId: "asset-btc",
        type: "BUY",
        quantity: 1,
        price: 45000,
        fee: 10,
        occurredAt: "2025-01-10T10:00:00.000Z",
        note: "Dlouhodobá pozice",
        createdAt: "",
        updatedAt: "",
        asset: { id: "asset-btc", symbol: "BTC", name: "Bitcoin", currency: "USD" },
      },
      {
        id: "tx-tsla",
        assetId: "asset-tsla",
        type: "BUY",
        quantity: 5,
        price: 300,
        fee: 2,
        occurredAt: "2025-01-12T10:00:00.000Z",
        note: "Tesla dip",
        createdAt: "",
        updatedAt: "",
        asset: { id: "asset-tsla", symbol: "TSLA", name: "Tesla", currency: "USD" },
      },
      {
        id: "tx-cez",
        assetId: "asset-cez",
        type: "SELL",
        quantity: 2,
        price: 1100,
        fee: 1,
        occurredAt: "2025-01-11T10:00:00.000Z",
        note: null,
        createdAt: "",
        updatedAt: "",
        asset: { id: "asset-cez", symbol: "CEZ", name: "ČEZ", currency: "CZK" },
      },
    ]);

    renderWithProviders(<TransactionsPage />);

    await screen.findByText("Bitcoin");

    await user.type(screen.getByRole("searchbox", { name: "Hledat" }), "tesla");
    expect(within(screen.getByRole("table")).getByText("TSLA")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).queryByText("BTC")).not.toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: "Hledat" }));
    await user.selectOptions(screen.getByLabelText("Měna"), "CZK");
    expect(within(screen.getByRole("table")).getByText("CEZ")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).queryByText("TSLA")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Měna"), "");
    await user.selectOptions(screen.getByLabelText("Řadit podle"), "value");
    await user.selectOptions(screen.getByLabelText("Směr řazení"), "desc");

    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByText("BTC")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("CEZ")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("TSLA")).toBeInTheDocument();
  });
});
