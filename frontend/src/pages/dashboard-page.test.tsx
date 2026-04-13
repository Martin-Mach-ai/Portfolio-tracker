import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../lib/api";
import { renderWithProviders } from "../test/render";
import { DashboardPage } from "./dashboard-page";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");

  return {
    ...actual,
    getHoldings: vi.fn(),
    getPortfolioPerformance: vi.fn(),
  };
});

function createHolding(overrides: Partial<api.Holding>): api.Holding {
  return {
    assetId: "asset",
    symbol: "AAPL",
    name: "Apple",
    currency: "USD",
    assetClass: "STOCK",
    sector: "Technologie",
    region: "Severní Amerika",
    continent: "Severní Amerika",
    baseCurrency: "USD",
    fxRateToBase: 1,
    quantity: 1,
    averageCost: 100,
    costBasis: 100,
    costBasisBase: 100,
    currentPrice: 120,
    marketValue: 120,
    marketValueBase: 120,
    unrealizedPnL: 20,
    unrealizedPnLBase: 20,
    realizedPnLBase: 10,
    hasMarketPrice: true,
    priceSource: "stored",
    priceAsOf: "2025-01-10T00:00:00.000Z",
    marketDataSymbol: null,
    ...overrides,
  };
}

function createPerformance(overrides?: Partial<api.PortfolioPerformance>): api.PortfolioPerformance {
  return {
    currency: "USD",
    benchmarkLabel: "S&P 500",
    points: [
      {
        date: "2025-01-10",
        portfolioValue: 120,
        costBasis: 100,
        unrealizedPnL: 20,
        benchmarkValue: 120,
        portfolioReturnPct: 0,
        benchmarkReturnPct: 0,
      },
      {
        date: "2025-01-11",
        portfolioValue: 130,
        costBasis: 100,
        unrealizedPnL: 30,
        benchmarkValue: 126,
        portfolioReturnPct: 8.333333,
        benchmarkReturnPct: 5,
      },
    ],
    coverage: {
      hasPortfolioData: true,
      hasBenchmarkData: true,
      missingSymbols: [],
      missingCurrencies: [],
      marketValuePointCount: 2,
      costBasisPointCount: 2,
    },
    ...overrides,
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the upgraded dashboard with charts, metrics and holdings table", async () => {
    vi.mocked(api.getHoldings).mockResolvedValue([
      createHolding({
        assetId: "btc",
        symbol: "BTC",
        name: "Bitcoin",
        assetClass: "CRYPTO",
        sector: "Ostatní",
        region: "Globální",
        continent: "Ostatní",
        quantity: 1.5,
        averageCost: 40050,
        costBasis: 60075,
        costBasisBase: 60075,
        currentPrice: 45000,
        marketValue: 67500,
        marketValueBase: 67500,
        unrealizedPnL: 7425,
        unrealizedPnLBase: 7425,
        realizedPnLBase: 500,
        priceSource: "market_data",
        priceAsOf: "2025-01-10T00:00:00.000Z",
        marketDataSymbol: "BTC",
      }),
    ]);
    vi.mocked(api.getPortfolioPerformance).mockResolvedValue(createPerformance());

    renderWithProviders(<DashboardPage />);

    expect(await screen.findByRole("heading", { name: "Vývoj portfolia v čase" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Přehled portfolia/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rozložení podle sektorů" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rozložení podle měn" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rozložení podle regionu" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Největší pozice" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Kontrola pokrytí dashboardu" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Otevřené pozice/i })).toBeInTheDocument();
    expect(screen.getByText("Realizované PnL")).toBeInTheDocument();
    expect(screen.getAllByText("Bitcoin").length).toBeGreaterThan(0);
    expect(screen.getAllByText("BTC").length).toBeGreaterThan(0);
    expect(screen.getByText(/Base currency: USD/i)).toBeInTheDocument();
  });

  it("shows fallback states and coverage warnings only where dashboard data is still missing", async () => {
    vi.mocked(api.getHoldings).mockResolvedValue([
      createHolding({
        symbol: "AAPL",
        name: "Apple",
        marketValue: null,
        marketValueBase: null,
        currentPrice: null,
        unrealizedPnL: null,
        unrealizedPnLBase: null,
        costBasisBase: 200,
        realizedPnLBase: 0,
        priceSource: "unavailable",
        priceAsOf: null,
        sector: "Neznámé",
        region: "Neznámé",
        continent: "Neznámé",
      }),
    ]);
    vi.mocked(api.getPortfolioPerformance).mockResolvedValue(
      createPerformance({
        points: [
          {
            date: "2025-01-10",
            portfolioValue: null,
            costBasis: 200,
            unrealizedPnL: null,
            benchmarkValue: null,
            portfolioReturnPct: null,
            benchmarkReturnPct: null,
          },
        ],
        coverage: {
          hasPortfolioData: true,
          hasBenchmarkData: false,
          missingSymbols: ["AAPL"],
          missingCurrencies: ["USD"],
          marketValuePointCount: 0,
          costBasisPointCount: 1,
        },
      }),
    );

    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText(/Část pozic nemá aktuální cenu/i)).toBeInTheDocument();
    expect(screen.getByText(/Market value není k dispozici/i)).toBeInTheDocument();
    expect(screen.getByText(/Chybí historie pro symboly: AAPL/i)).toBeInTheDocument();
    expect(screen.getByText(/Chybí FX historie pro měny: USD/i)).toBeInTheDocument();
    expect(screen.getByText(/pozice se dashboard přepíná na cost basis fallback/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Cost basis fallback/i).length).toBeGreaterThan(0);
  });

  it("keeps EUR holdings in allocations and top holdings through base-value normalization", async () => {
    vi.mocked(api.getHoldings).mockResolvedValue([
      createHolding({
        assetId: "eur-1",
        symbol: "RHM.DE",
        name: "Rheinmetall AG mit extra dlouhým názvem",
        currency: "EUR",
        fxRateToBase: 1.09,
        sector: "",
        region: "",
        continent: "",
        currentPrice: null,
        marketValue: null,
        marketValueBase: null,
        costBasis: 650,
        costBasisBase: null,
        unrealizedPnL: null,
        unrealizedPnLBase: null,
        priceSource: "unavailable",
        priceAsOf: null,
      }),
      createHolding({
        assetId: "usd-1",
        symbol: "AAPL",
        name: "Apple",
        quantity: 2,
        costBasis: 300,
        costBasisBase: 300,
        currentPrice: 180,
        marketValue: 360,
        marketValueBase: 360,
        unrealizedPnL: 60,
        unrealizedPnLBase: 60,
      }),
    ]);
    vi.mocked(api.getPortfolioPerformance).mockResolvedValue(createPerformance());

    renderWithProviders(<DashboardPage />);

    expect(await screen.findByRole("heading", { name: "Největší pozice" })).toBeInTheDocument();
    expect(screen.getAllByText("EUR").length).toBeGreaterThan(0);
    expect(screen.getAllByText("RHM.DE").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Evropa").length).toBeGreaterThan(0);
    expect(screen.getByText("Cost basis fallback")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rozložení podle měn" })).toBeInTheDocument();
  });

  it("keeps sparse backend payloads inside donuts through frontend normalization", async () => {
    vi.mocked(api.getHoldings).mockResolvedValue([
      {
        assetId: "sap",
        symbol: "SAP",
        name: "SAP",
        currency: "EUR",
        assetClass: "STOCK",
        quantity: 2,
        averageCost: 100,
        costBasis: 200,
        currentPrice: null,
        marketValue: null,
        unrealizedPnL: null,
        hasMarketPrice: false,
        priceSource: "unavailable",
        priceAsOf: null,
        marketDataSymbol: null,
      } as unknown as api.Holding,
      {
        assetId: "cez",
        symbol: "CEZ",
        name: "CEZ",
        currency: "CZK",
        assetClass: "STOCK",
        quantity: 8,
        averageCost: 920,
        costBasis: 7360,
        currentPrice: null,
        marketValue: null,
        unrealizedPnL: null,
        hasMarketPrice: false,
        priceSource: "unavailable",
        priceAsOf: null,
        marketDataSymbol: null,
      } as unknown as api.Holding,
      {
        assetId: "jpm",
        symbol: "JPM",
        name: "JPMorgan Chase",
        currency: "USD",
        assetClass: "STOCK",
        quantity: 3,
        averageCost: 150,
        costBasis: 450,
        currentPrice: null,
        marketValue: null,
        unrealizedPnL: null,
        hasMarketPrice: false,
        priceSource: "unavailable",
        priceAsOf: null,
        marketDataSymbol: null,
      } as unknown as api.Holding,
      {
        assetId: "vici",
        symbol: "VICI.US",
        name: "VICI.US",
        currency: "USD",
        assetClass: "STOCK",
        quantity: 10,
        averageCost: 30,
        costBasis: 300,
        currentPrice: null,
        marketValue: null,
        unrealizedPnL: null,
        hasMarketPrice: false,
        priceSource: "unavailable",
        priceAsOf: null,
        marketDataSymbol: null,
      } as unknown as api.Holding,
    ]);
    vi.mocked(api.getPortfolioPerformance).mockResolvedValue(createPerformance());

    renderWithProviders(<DashboardPage />);

    expect(await screen.findByRole("heading", { name: "Rozložení podle měn" })).toBeInTheDocument();
    expect(screen.getAllByText("EUR").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CZK").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Evropa").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Neznámý sektor").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Mimo graf:/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Fallback: 4 pozice/i).length).toBeGreaterThan(0);
  });

  it("filters and sorts holdings in the table using normalized values", async () => {
    const user = userEvent.setup();

    vi.mocked(api.getHoldings).mockResolvedValue([
      createHolding({
        assetId: "btc",
        symbol: "BTC",
        name: "Bitcoin",
        assetClass: "CRYPTO",
        sector: "Ostatní",
        region: "Globální",
        continent: "Ostatní",
        quantity: 1.5,
        marketValue: 67500,
        marketValueBase: 67500,
        costBasis: 60075,
        costBasisBase: 60075,
        unrealizedPnL: 7425,
        unrealizedPnLBase: 7425,
      }),
      createHolding({
        assetId: "cez",
        symbol: "CEZ",
        name: "ČEZ",
        currency: "CZK",
        sector: "Energie",
        region: "Evropa",
        continent: "Evropa",
        fxRateToBase: 0.043,
        quantity: 20,
        averageCost: 950,
        costBasis: 19000,
        costBasisBase: 817,
        currentPrice: 1100,
        marketValue: 22000,
        marketValueBase: 946,
        unrealizedPnL: 3000,
        unrealizedPnLBase: 129,
      }),
      createHolding({
        assetId: "aapl",
        symbol: "AAPL",
        name: "Apple",
        quantity: 10,
        averageCost: 150,
        costBasis: 1500,
        costBasisBase: 1500,
        currentPrice: 170,
        marketValue: 1700,
        marketValueBase: 1700,
        unrealizedPnL: 200,
        unrealizedPnLBase: 200,
      }),
    ]);
    vi.mocked(api.getPortfolioPerformance).mockResolvedValue(createPerformance());

    renderWithProviders(<DashboardPage />);

    await screen.findByRole("heading", { name: "Největší pozice" });

    const table = screen.getByRole("table");
    const searchbox = screen.getByRole("searchbox", { name: "Hledat" });
    await user.type(searchbox, "apple");
    expect(within(table).getByText("AAPL")).toBeInTheDocument();
    expect(within(table).queryByText("BTC")).not.toBeInTheDocument();

    await user.clear(searchbox);
    await user.selectOptions(screen.getByLabelText("Měna"), "CZK");
    expect(within(table).getByText("CEZ")).toBeInTheDocument();
    expect(within(table).queryByText("AAPL")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Měna"), "");
    await user.selectOptions(screen.getByLabelText("Řadit podle"), "marketValue");
    await user.selectOptions(screen.getByLabelText("Směr řazení"), "desc");

    const rows = within(table).getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByText("BTC")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("AAPL")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("CEZ")).toBeInTheDocument();
  });
});
