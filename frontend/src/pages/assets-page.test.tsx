import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssetsPage } from "./assets-page";
import { ApiError } from "../lib/api";
import { renderWithProviders } from "../test/render";
import * as api from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");

  return {
    ...actual,
    getAssets: vi.fn(),
    createAsset: vi.fn(),
    updateAsset: vi.fn(),
    deleteAsset: vi.fn(),
  };
});

describe("AssetsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders server validation errors in the form", async () => {
    const user = userEvent.setup();

    vi.mocked(api.getAssets).mockResolvedValue([]);
    vi.mocked(api.createAsset).mockRejectedValue(
      new ApiError(409, "ASSET_EXISTS", "An asset with this symbol already exists"),
    );

    renderWithProviders(<AssetsPage />);

    await screen.findByText("Zatím žádná aktiva");
    await user.click(screen.getByRole("button", { name: "Přidat aktivum" }));
    await user.type(screen.getByLabelText("Ticker"), "btc");
    await user.type(screen.getByLabelText("Název"), "Bitcoin");
    await user.clear(screen.getByLabelText("Aktuální cena"));
    await user.type(screen.getByLabelText("Aktuální cena"), "45000");
    await user.click(screen.getByRole("button", { name: "Vytvořit aktivum" }));

    expect(await screen.findByText("An asset with this symbol already exists")).toBeInTheDocument();
  });

  it("filters and sorts assets in the table", async () => {
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
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-12T10:00:00.000Z",
      },
      {
        id: "asset-cez",
        symbol: "CEZ",
        name: "ČEZ",
        currency: "CZK",
        assetClass: "STOCK",
        portfolioEligible: true,
        currentPrice: 1100,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-10T10:00:00.000Z",
      },
      {
        id: "asset-aapl",
        symbol: "AAPL",
        name: "Apple",
        currency: "USD",
        assetClass: "STOCK",
        portfolioEligible: true,
        currentPrice: 210,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-11T10:00:00.000Z",
      },
    ]);

    renderWithProviders(<AssetsPage />);

    await screen.findByText("Bitcoin");

    await user.type(screen.getByRole("searchbox", { name: "Hledat" }), "bit");
    expect(screen.getByText("BTC")).toBeInTheDocument();
    expect(screen.queryByText("AAPL")).not.toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: "Hledat" }));
    await user.selectOptions(screen.getByLabelText("Měna"), "CZK");
    expect(screen.getByText("CEZ")).toBeInTheDocument();
    expect(screen.queryByText("BTC")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Měna"), "");
    await user.selectOptions(screen.getByLabelText("Řadit podle"), "currentPrice");
    await user.selectOptions(screen.getByLabelText("Směr řazení"), "desc");

    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByText("BTC")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("CEZ")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("AAPL")).toBeInTheDocument();
  });
});
