import request from "supertest";
import * as XLSX from "xlsx";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { app } from "../src/app";
import { prisma } from "../src/lib/prisma";

type WorkbookSheet = {
  name: string;
  rows: unknown[][];
};

function createWorkbookBuffer(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Report");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function createWorkbookBufferFromSheets(sheets: WorkbookSheet[]): Buffer {
  const workbook = XLSX.utils.book_new();

  for (const sheetData of sheets) {
    const sheet = XLSX.utils.aoa_to_sheet(sheetData.rows);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetData.name);
  }

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function createCurrentXtbWorkbookBuffer(): Buffer {
  return createWorkbookBufferFromSheets([
    {
      name: "Closed Positions",
      rows: [
        ["XTB Export history"],
        ["Account", "1234567"],
        ["Generated", "2026-03-10 12:34:56"],
        ["Product", "My Trades"],
        [
          "Instrument",
          "Category",
          "Ticker",
          "Type",
          "Volume",
          "Open price",
          "Open Time (UTC)",
          "Close price",
          "Close Time (UTC)",
          "Product",
          "Profit/Loss",
          "Gross Profit",
        ],
        [
          "Aehr Test",
          "STOCK",
          "AEHR.US",
          "BUY",
          3,
          20.49,
          "2024-07-18 14:04:09.350",
          28.11,
          "2025-09-15 18:37:11.344",
          "My Trades",
          299.96,
          299.96,
        ],
        [
          "ETHEREUM",
          "CFD",
          "ETHEREUM",
          "BUY",
          0.12,
          3731.36,
          "2024-12-11 12:24:27.345",
          3916.21,
          "2024-12-12 09:07:02.763",
          "My Trades",
          518.18,
          528.91,
        ],
      ],
    },
    {
      name: "Cash Operations",
      rows: [
        ["XTB Export history"],
        ["Account", "1234567"],
        ["Generated", "2026-03-10 12:34:56"],
        ["Product", "My Trades"],
        ["Type", "Instrument", "Time", "Amount", "ID", "Comment", "Product"],
        [
          "Free funds interest",
          null,
          "2026-03-04 23:58:21.844",
          2.12,
          1161290325,
          "Free-funds Interest 2026-02",
          "My Trades",
        ],
        [
          "Dividend",
          "BAT",
          "2026-02-13 10:59:46.058",
          148.98,
          1137227341,
          "BTI.US USD 0.8134/ SHR",
          "My Trades",
        ],
      ],
    },
  ]);
}

function createCsvBuffer(rows: string[][]): Buffer {
  return Buffer.from(rows.map((row) => row.join(",")).join("\n"), "utf8");
}

describe.sequential("portfolio tracker API", () => {
  beforeEach(async () => {
    await prisma.transaction.deleteMany();
    await prisma.importedBrokerRow.deleteMany();
    await prisma.importedPosition.deleteMany();
    await prisma.asset.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("responds to the health endpoint", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("creates, updates, lists, and deletes assets", async () => {
    const createResponse = await request(app).post("/api/assets").send({
      symbol: "aapl",
      name: "Apple Inc.",
      currency: "usd",
      currentPrice: 185.32,
    });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.symbol).toBe("AAPL");
    expect(createResponse.body.data.currency).toBe("USD");

    const assetId = createResponse.body.data.id as string;

    const patchResponse = await request(app).patch(`/api/assets/${assetId}`).send({
      currentPrice: 190.5,
    });

    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body.data.currentPrice).toBe(190.5);

    const listResponse = await request(app).get("/api/assets");

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data).toHaveLength(1);

    const deleteResponse = await request(app).delete(`/api/assets/${assetId}`);

    expect(deleteResponse.status).toBe(204);
  });

  it("creates, reads, updates, and deletes transactions", async () => {
    const assetResponse = await request(app).post("/api/assets").send({
      symbol: "msft",
      name: "Microsoft",
      currency: "USD",
      currentPrice: 410,
    });

    const assetId = assetResponse.body.data.id as string;

    const createResponse = await request(app).post("/api/transactions").send({
      assetId,
      type: "BUY",
      quantity: 2,
      price: 400,
      fee: 1.5,
      occurredAt: "2025-01-10T10:00:00.000Z",
      note: "Initial purchase",
    });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.asset.symbol).toBe("MSFT");

    const transactionId = createResponse.body.data.id as string;

    const getResponse = await request(app).get(`/api/transactions/${transactionId}`);

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.data.quantity).toBe(2);

    const updateResponse = await request(app).patch(`/api/transactions/${transactionId}`).send({
      quantity: 3,
      fee: 2,
    });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data.quantity).toBe(3);
    expect(updateResponse.body.data.fee).toBe(2);

    const deleteResponse = await request(app).delete(`/api/transactions/${transactionId}`);

    expect(deleteResponse.status).toBe(204);
  });

  it("rejects sell transactions that exceed current holdings", async () => {
    const assetResponse = await request(app).post("/api/assets").send({
      symbol: "nvda",
      name: "NVIDIA",
      currency: "USD",
      currentPrice: 900,
    });

    const assetId = assetResponse.body.data.id as string;

    await request(app).post("/api/transactions").send({
      assetId,
      type: "BUY",
      quantity: 1,
      price: 850,
      fee: 0,
      occurredAt: "2025-01-05T10:00:00.000Z",
    });

    const invalidSell = await request(app).post("/api/transactions").send({
      assetId,
      type: "SELL",
      quantity: 2,
      price: 910,
      fee: 0,
      occurredAt: "2025-01-06T10:00:00.000Z",
    });

    expect(invalidSell.status).toBe(422);
    expect(invalidSell.body.error.code).toBe("INVALID_LEDGER");
  });

  it("blocks deleting assets with transaction history", async () => {
    const assetResponse = await request(app).post("/api/assets").send({
      symbol: "tsla",
      name: "Tesla",
      currency: "USD",
      currentPrice: 250,
    });

    const assetId = assetResponse.body.data.id as string;

    await request(app).post("/api/transactions").send({
      assetId,
      type: "BUY",
      quantity: 5,
      price: 200,
      fee: 0,
      occurredAt: "2025-02-01T10:00:00.000Z",
    });

    const response = await request(app).delete(`/api/assets/${assetId}`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ASSET_HAS_TRANSACTIONS");
  });

  it("derives holdings and summary totals from transactions and manual prices", async () => {
    const btcResponse = await request(app).post("/api/assets").send({
      symbol: "btc",
      name: "Bitcoin",
      currency: "USD",
      currentPrice: 45000,
    });
    const ethResponse = await request(app).post("/api/assets").send({
      symbol: "eth",
      name: "Ethereum",
      currency: "USD",
      currentPrice: 3200,
    });

    const btcId = btcResponse.body.data.id as string;
    const ethId = ethResponse.body.data.id as string;

    await request(app).post("/api/transactions").send({
      assetId: btcId,
      type: "BUY",
      quantity: 2,
      price: 40000,
      fee: 100,
      occurredAt: "2025-01-01T10:00:00.000Z",
    });

    await request(app).post("/api/transactions").send({
      assetId: btcId,
      type: "SELL",
      quantity: 0.5,
      price: 43000,
      fee: 20,
      occurredAt: "2025-01-15T10:00:00.000Z",
    });

    await request(app).post("/api/transactions").send({
      assetId: ethId,
      type: "BUY",
      quantity: 3,
      price: 2500,
      fee: 15,
      occurredAt: "2025-01-03T10:00:00.000Z",
    });

    const holdingsResponse = await request(app).get("/api/portfolio/holdings");

    expect(holdingsResponse.status).toBe(200);
    expect(holdingsResponse.body.data).toHaveLength(2);

    const btcHolding = holdingsResponse.body.data.find(
      (holding: { symbol: string }) => holding.symbol === "BTC",
    ) as {
      quantity: number;
      costBasis: number;
      marketValue: number;
    };

    expect(btcHolding.quantity).toBe(1.5);
    expect(btcHolding.marketValue).toBe(67500);
    expect(btcHolding.costBasis).toBe(60075);

    const summaryResponse = await request(app).get("/api/portfolio/summary");

    expect(summaryResponse.status).toBe(200);
    expect(summaryResponse.body.data.totals.assetCount).toBe(2);
    expect(summaryResponse.body.data.totals.marketValue).toBe(77100);
    expect(summaryResponse.body.data.totals.costBasis).toBe(67590);
    expect(summaryResponse.body.data.totals.unrealizedPnL).toBe(9510);
  });

  it("keeps holdings and totals incomplete when current prices are missing", async () => {
    const asset = await prisma.asset.create({
      data: {
        symbol: "AAPL",
        name: "Apple",
        currency: "USD",
        currentPrice: 0,
      },
    });

    await prisma.transaction.create({
      data: {
        assetId: asset.id,
        type: "BUY",
        quantity: 2,
        price: 100,
        fee: 0,
        occurredAt: new Date("2025-01-10T10:00:00.000Z"),
      },
    });

    const holdingsResponse = await request(app).get("/api/portfolio/open-positions");

    expect(holdingsResponse.status).toBe(200);
    expect(holdingsResponse.body.data[0].symbol).toBe("AAPL");
    expect(holdingsResponse.body.data[0].currentPrice).toBeNull();
    expect(holdingsResponse.body.data[0].marketValue).toBeNull();
    expect(holdingsResponse.body.data[0].unrealizedPnL).toBeNull();
    expect(holdingsResponse.body.data[0].priceSource).toBe("unavailable");

    const summaryResponse = await request(app).get("/api/portfolio/summary");

    expect(summaryResponse.status).toBe(200);
    expect(summaryResponse.body.data.totals.costBasis).toBe(200);
    expect(summaryResponse.body.data.totals.marketValue).toBeNull();
    expect(summaryResponse.body.data.totals.unrealizedPnL).toBeNull();
    expect(summaryResponse.body.data.totals.pricedAssetCount).toBe(0);
    expect(summaryResponse.body.data.totals.unpricedAssetCount).toBe(1);
    expect(summaryResponse.body.data.totals.hasCompleteMarketData).toBe(false);
  });

  it("keeps EUR holdings in dashboard-facing base totals through the cost basis fallback", async () => {
    const asset = await prisma.asset.create({
      data: {
        symbol: "SAP",
        name: "SAP",
        currency: "EUR",
        currentPrice: 0,
      },
    });

    await prisma.transaction.create({
      data: {
        assetId: asset.id,
        type: "BUY",
        quantity: 2,
        price: 100,
        fee: 0,
        occurredAt: new Date("2025-01-10T10:00:00.000Z"),
      },
    });

    const holdingsResponse = await request(app).get("/api/portfolio/holdings");

    expect(holdingsResponse.status).toBe(200);
    expect(holdingsResponse.body.data).toHaveLength(1);
    expect(holdingsResponse.body.data[0].currency).toBe("EUR");
    expect(holdingsResponse.body.data[0].fxRateToBase).toBe(1.09);
    expect(holdingsResponse.body.data[0].costBasisBase).toBe(218);
    expect(holdingsResponse.body.data[0].marketValueBase).toBeNull();
    expect(holdingsResponse.body.data[0].region).toBe("Evropa");
    expect(holdingsResponse.body.data[0].continent).toBe("Evropa");

    const summaryResponse = await request(app).get("/api/portfolio/summary");

    expect(summaryResponse.status).toBe(200);
    expect(summaryResponse.body.data.totals.costBasis).toBe(218);
    expect(summaryResponse.body.data.totals.marketValue).toBeNull();
    expect(summaryResponse.body.data.totals.unpricedAssetCount).toBe(1);
  });

  it("keeps partial summary totals when only some holdings have prices and uses GBX fallback for base cost basis", async () => {
    const pricedAsset = await prisma.asset.create({
      data: {
        symbol: "AAPL",
        name: "Apple",
        currency: "USD",
        currentPrice: 120,
      },
    });
    const gbxAsset = await prisma.asset.create({
      data: {
        symbol: "RR",
        name: "Rolls-Royce",
        currency: "GBX",
        currentPrice: 0,
      },
    });

    await prisma.transaction.createMany({
      data: [
        {
          assetId: pricedAsset.id,
          type: "BUY",
          quantity: 2,
          price: 100,
          fee: 0,
          occurredAt: new Date("2025-01-10T10:00:00.000Z"),
        },
        {
          assetId: gbxAsset.id,
          type: "BUY",
          quantity: 100,
          price: 1,
          fee: 0,
          occurredAt: new Date("2025-01-11T10:00:00.000Z"),
        },
      ],
    });

    const holdingsResponse = await request(app).get("/api/portfolio/holdings");

    expect(holdingsResponse.status).toBe(200);
    expect(holdingsResponse.body.data).toHaveLength(2);

    const gbxHolding = holdingsResponse.body.data.find(
      (holding: { symbol: string }) => holding.symbol === "RR",
    ) as {
      fxRateToBase: number | null;
      costBasisBase: number | null;
      marketValueBase: number | null;
    };

    expect(gbxHolding.fxRateToBase).toBe(0.0128);
    expect(gbxHolding.costBasisBase).toBe(1.28);
    expect(gbxHolding.marketValueBase).toBeNull();

    const summaryResponse = await request(app).get("/api/portfolio/summary");

    expect(summaryResponse.status).toBe(200);
    expect(summaryResponse.body.data.totals.marketValue).toBe(240);
    expect(summaryResponse.body.data.totals.costBasis).toBe(201.28);
    expect(summaryResponse.body.data.totals.unrealizedPnL).toBe(40);
    expect(summaryResponse.body.data.totals.pricedAssetCount).toBe(1);
    expect(summaryResponse.body.data.totals.unpricedAssetCount).toBe(1);
    expect(summaryResponse.body.data.totals.hasCompleteMarketData).toBe(false);
  });

  it("previews and commits XTB imports through the generic endpoint, auto-creating missing assets", async () => {
    const workbook = createWorkbookBuffer([
      ["XTB history export"],
      ["Created", "2025-03-09"],
      [],
      [
        "Position ID",
        "Instrument",
        "Category",
        "Type",
        "Open Time",
        "Close Time",
        "Volume",
        "Open Price",
        "Close Price",
        "Profit",
        "Currency",
      ],
      [9001, "AAPL.US", "STOCK", "BUY", "2025-01-10T09:00:00.000Z", "2025-01-10T10:00:00.000Z", 1, 190, 205, 15, "USD"],
    ]);

    const previewResponse = await request(app)
      .post("/api/imports/prepare")
      .attach("file", workbook, "xtb-report.xlsx");

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.body.data.broker).toBe("XTB");
    expect(previewResponse.body.data.summary.readyCount).toBe(1);
    expect(previewResponse.body.data.transactions).toHaveLength(2);
    expect(previewResponse.body.data.transactions[0].externalId).toBe("9001");

    const commitResponse = await request(app).post("/api/imports/commit").send({
      broker: previewResponse.body.data.broker,
      items: previewResponse.body.data.items,
    });

    expect(commitResponse.status).toBe(201);
    expect(commitResponse.body.data.importedItemCount).toBe(1);
    expect(commitResponse.body.data.transactionCount).toBe(2);

    const assets = await prisma.asset.findMany();
    expect(assets).toHaveLength(1);
    expect(assets[0]?.symbol).toBe("AAPL.US");

    const importedPositions = await prisma.importedPosition.findMany();
    expect(importedPositions).toHaveLength(1);
    expect(importedPositions[0]?.externalId).toMatch(/^xtb\|9001\|/);

    const transactions = await prisma.transaction.findMany({
      include: { importedPosition: true },
      orderBy: [{ occurredAt: "asc" }],
    });

    expect(transactions).toHaveLength(2);
    expect(transactions[0]?.type).toBe("BUY");
    expect(transactions[1]?.type).toBe("SELL");
    expect(transactions[0]?.importedPosition?.externalId).toMatch(/^xtb\|9001\|/);
  });

  it("accepts the current multi-sheet XTB export format through the generic endpoint", async () => {
    const workbook = createCurrentXtbWorkbookBuffer();

    const previewResponse = await request(app)
      .post("/api/imports/preview")
      .attach("file", workbook, "CZK_xtb-current-report.xlsx");

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.body.data.broker).toBe("XTB");
    expect(previewResponse.body.data.summary.itemCount).toBe(2);
    expect(previewResponse.body.data.summary.readyCount).toBe(2);
    expect(previewResponse.body.data.summary.includedCount).toBe(1);
    expect(previewResponse.body.data.summary.excludedCount).toBe(1);
    expect(previewResponse.body.data.transactions).toHaveLength(2);
    expect(previewResponse.body.data.items[0].symbol).toBe("AEHR.US");
    expect(previewResponse.body.data.items[0].currency).toBe("USD");
    expect(previewResponse.body.data.items[0].profit).toBe(299.96);
    expect(previewResponse.body.data.items[0].openTime).toBe("2024-07-18T14:04:09.350Z");
    expect(previewResponse.body.data.items[0].externalId).toMatch(/^generated:/);
    expect(previewResponse.body.data.items[1].portfolioEligible).toBe(false);

    const commitResponse = await request(app).post("/api/imports/commit").send({
      broker: previewResponse.body.data.broker,
      items: previewResponse.body.data.items,
    });

    expect(commitResponse.status).toBe(201);
    expect(commitResponse.body.data.importedItemCount).toBe(2);
    expect(commitResponse.body.data.includedItemCount).toBe(1);
    expect(commitResponse.body.data.excludedItemCount).toBe(1);
    expect(commitResponse.body.data.transactionCount).toBe(2);

    const assets = await prisma.asset.findMany({ orderBy: [{ symbol: "asc" }] });
    expect(assets).toHaveLength(1);
    expect(assets[0]?.symbol).toBe("AEHR.US");
    expect(assets[0]?.currency).toBe("USD");

    const importedPositions = await prisma.importedPosition.findMany({
      orderBy: [{ symbol: "asc" }],
    });
    expect(importedPositions).toHaveLength(2);
    expect(importedPositions[0]?.symbol).toBe("AEHR.US");
    expect(Number(importedPositions[0]?.profit ?? 0)).toBe(299.96);
    expect(importedPositions[1]?.symbol).toBe("ETHEREUM");
    expect(Number(importedPositions[1]?.profit ?? 0)).toBe(518.18);
    expect(importedPositions[1]?.portfolioEligible).toBe(false);
  });

  it("rejects mismatched files for explicit XTB preview requests and prevents duplicate XTB commits", async () => {
    const invalidUpload = await request(app)
      .post("/api/imports/preview")
      .field("broker", "XTB")
      .attach("file", Buffer.from("not a workbook"), "xtb-report.csv");

    expect(invalidUpload.status).toBe(400);
    expect(invalidUpload.body.error.code).toBe("XTB_PARSE_ERROR");

    const workbook = createWorkbookBuffer([
      ["XTB history export"],
      ["Created", "2025-03-09"],
      [],
      [
        "Position ID",
        "Instrument",
        "Type",
        "Open Time",
        "Close Time",
        "Volume",
        "Open Price",
        "Close Price",
        "Profit",
        "Currency",
      ],
      [7777, "ETHUSD", "BUY", "2025-01-10T09:00:00.000Z", "2025-01-10T10:00:00.000Z", 2, 2200, 2250, 100, "USD"],
    ]);

    const previewResponse = await request(app)
      .post("/api/imports/preview")
      .attach("file", workbook, "xtb-report.xlsx");

    await request(app).post("/api/imports/commit").send({
      broker: previewResponse.body.data.broker,
      items: previewResponse.body.data.items,
    });

    const duplicatePreview = await request(app)
      .post("/api/imports/preview")
      .attach("file", workbook, "xtb-report.xlsx");

    expect(duplicatePreview.status).toBe(200);
    expect(duplicatePreview.body.data.summary.duplicateCount).toBe(1);
    expect(duplicatePreview.body.data.items[0].status).toBe("duplicate");

    const duplicateCommit = await request(app).post("/api/imports/commit").send({
      broker: duplicatePreview.body.data.broker,
      items: duplicatePreview.body.data.items,
    });

    expect(duplicateCommit.status).toBe(400);
    expect(duplicateCommit.body.error.code).toBe("NO_IMPORTABLE_ROWS");
  });

  it("marks only matching XTB rows as duplicates while leaving new rows ready and sell-first rows invalid", async () => {
    const dataRows = Array.from({ length: 36 }, (_, index) => {
      const rowNumber = index + 1;

      if (rowNumber === 36) {
        return [
          9936,
          "TSLA.US",
          "STOCK",
          "SELL",
          "2025-02-20T10:35:00.000Z",
          "2025-02-20T11:05:00.000Z",
          1,
          330,
          325,
          -5,
          "USD",
        ];
      }

      return [
        9900 + rowNumber,
        `READY${rowNumber}.US`,
        "STOCK",
        "BUY",
        `2025-02-${String((rowNumber % 28) + 1).padStart(2, "0")}T10:${String(rowNumber % 60).padStart(2, "0")}:00.000Z`,
        `2025-02-${String((rowNumber % 28) + 1).padStart(2, "0")}T11:${String(rowNumber % 60).padStart(2, "0")}:00.000Z`,
        1,
        100 + rowNumber,
        110 + rowNumber,
        10,
        "USD",
      ];
    });

    const workbook = createWorkbookBuffer([
      ["XTB history export"],
      ["Created", "2025-03-09"],
      [],
      [
        "Position ID",
        "Instrument",
        "Category",
        "Type",
        "Open Time",
        "Close Time",
        "Volume",
        "Open Price",
        "Close Price",
        "Profit",
        "Currency",
      ],
      ...dataRows,
    ]);

    for (const row of dataRows.slice(0, 4)) {
      await prisma.importedPosition.create({
        data: {
          broker: "XTB",
          externalId: String(row[0]),
          symbol: String(row[1]),
          currency: "USD",
          assetClass: "STOCK",
          portfolioEligible: true,
          category: "STOCK",
          positionState: "CLOSED",
          direction: "BUY",
          openTime: new Date(String(row[4])),
          closeTime: new Date(String(row[5])),
          volume: Number(row[6]),
          openPrice: Number(row[7]),
          closePrice: Number(row[8]),
          profit: Number(row[9]),
        },
      });
    }

    const previewResponse = await request(app)
      .post("/api/imports/preview")
      .attach("file", workbook, "xtb-mixed-duplicates.xlsx");

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.body.data.broker).toBe("XTB");
    expect(previewResponse.body.data.summary.itemCount).toBe(36);
    expect(previewResponse.body.data.summary.readyCount).toBe(31);
    expect(previewResponse.body.data.summary.duplicateCount).toBe(4);
    expect(previewResponse.body.data.summary.invalidCount).toBe(1);

    const duplicateItems = previewResponse.body.data.items.filter(
      (item: { status: string }) => item.status === "duplicate",
    );
    const invalidItems = previewResponse.body.data.items.filter(
      (item: { status: string }) => item.status === "invalid",
    );
    const readyItems = previewResponse.body.data.items.filter(
      (item: { status: string }) => item.status === "ready",
    );

    expect(duplicateItems).toHaveLength(4);
    expect(readyItems).toHaveLength(31);
    expect(invalidItems).toHaveLength(1);
    expect(invalidItems[0]?.externalId).toBe("9936");
    expect(invalidItems[0]?.issues.map((issue: { code: string }) => issue.code)).toContain("UNSUPPORTED_DIRECTION");
  });

  it("imports XTB open positions as current holdings while excluding non-eligible rows from portfolio endpoints", async () => {
    const workbook = createWorkbookBufferFromSheets([
      {
        name: "Open Positions",
        rows: [
          ["XTB history export"],
          ["Created", "2025-03-09"],
          [],
          ["Position ID", "Ticker", "Category", "Type", "Open Time", "Volume", "Open Price", "Currency"],
          [9101, "AAPL.US", "STOCK", "BUY", "2025-01-10T09:00:00.000Z", 2, 190, "USD"],
          [9102, "ETHEREUM", "CFD", "BUY", "2025-01-11T09:00:00.000Z", 0.2, 3200, "USD"],
        ],
      },
    ]);

    const previewResponse = await request(app)
      .post("/api/imports/preview")
      .attach("file", workbook, "xtb-open-positions.xlsx");

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.body.data.summary.itemCount).toBe(2);
    expect(previewResponse.body.data.summary.includedCount).toBe(1);
    expect(previewResponse.body.data.summary.excludedCount).toBe(1);
    expect(previewResponse.body.data.transactions).toHaveLength(1);

    const commitResponse = await request(app).post("/api/imports/commit").send({
      broker: previewResponse.body.data.broker,
      items: previewResponse.body.data.items,
    });

    expect(commitResponse.status).toBe(201);
    expect(commitResponse.body.data.transactionCount).toBe(1);

    await prisma.asset.update({
      where: { symbol: "AAPL.US" },
      data: { currentPrice: 205 },
    });

    const holdingsResponse = await request(app).get("/api/portfolio/open-positions");
    expect(holdingsResponse.status).toBe(200);
    expect(holdingsResponse.body.data).toHaveLength(1);
    expect(holdingsResponse.body.data[0].symbol).toBe("AAPL.US");
    expect(holdingsResponse.body.data[0].quantity).toBe(2);

    const summaryResponse = await request(app).get("/api/portfolio/summary");
    expect(summaryResponse.status).toBe(200);
    expect(summaryResponse.body.data.totals.assetCount).toBe(1);
    expect(summaryResponse.body.data.totals.marketValue).toBe(410);
  });

  it("imports XTB stock trades from cash operations and builds holdings from the resulting ledger", async () => {
    const workbook = createWorkbookBufferFromSheets([
      {
        name: "Cash Operations",
        rows: [
          ["XTB Export history"],
          ["Account", "1234567"],
          ["Generated", "2026-03-23 12:34:56"],
          ["Product", "My Trades"],
          ["Type", "Instrument", "Time", "Amount", "ID", "Comment", "Product"],
          ["Dividend", "Aehr Test", "2025-01-05T09:00:00.000Z", 1, 1001, "AEHR.US USD 0.10/ SHR", "My Trades"],
          ["Dividend", "Shell", "2025-01-05T09:00:00.000Z", 1, 1002, "SHELL.NL EUR 0.10/ SHR", "My Trades"],
          ["Stock purchase", "Aehr Test", "2025-01-10T09:00:00.000Z", -380, 1003, "OPEN BUY 2 @ 190.00", "My Trades"],
          ["Stock sell", "Aehr Test", "2025-01-15T11:30:00.000Z", 205, 1004, "CLOSE BUY 1/2 @ 205.00", "My Trades"],
          ["Stock sell", "Shell", "2025-01-16T11:30:00.000Z", 31, 1005, "CLOSE BUY 1 @ 31.00", "My Trades"],
        ],
      },
    ]);

    const previewResponse = await request(app)
      .post("/api/imports/preview")
      .attach("file", workbook, "CZK_xtb-cash-ops.xlsx");

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.body.data.broker).toBe("XTB");
    expect(previewResponse.body.data.summary.itemCount).toBe(3);
    expect(previewResponse.body.data.summary.readyCount).toBe(2);
    expect(previewResponse.body.data.summary.invalidCount).toBe(1);
    expect(previewResponse.body.data.transactions).toHaveLength(3);
    expect(previewResponse.body.data.items[0].source).toBe("CASH_OPERATION");

    const commitResponse = await request(app).post("/api/imports/commit").send({
      broker: previewResponse.body.data.broker,
      items: previewResponse.body.data.items,
    });

    expect(commitResponse.status).toBe(201);
    expect(commitResponse.body.data.importedItemCount).toBe(2);
    expect(commitResponse.body.data.transactionCount).toBe(2);

    await prisma.asset.update({
      where: { symbol: "AEHR.US" },
      data: { currentPrice: 205 },
    });

    const holdingsResponse = await request(app).get("/api/portfolio/open-positions");

    expect(holdingsResponse.status).toBe(200);
    expect(holdingsResponse.body.data).toHaveLength(1);
    expect(holdingsResponse.body.data[0].symbol).toBe("AEHR.US");
    expect(holdingsResponse.body.data[0].quantity).toBe(1);
  });

  it("previews and commits Trading212 CSV imports, then blocks duplicates", async () => {
    const csv = createCsvBuffer([
      ["Action", "Time", "Ticker", "No. of shares", "Price / share", "Currency", "Fee", "ID"],
      ["Buy", "2025-01-10T09:00:00.000Z", "AAPL", "2", "190", "USD", "1", "T212-1"],
      ["Deposit", "2025-01-10T09:05:00.000Z", "", "", "", "USD", "", "T212-IGNORE"],
      ["Dividend (Dividend)", "2025-01-10T09:06:00.000Z", "AAPL", "2", "0.5", "USD", "", ""],
      ["Sell", "2025-01-15T11:30:00.000Z", "AAPL", "1", "205", "USD", "1", "T212-2"],
    ]);

    const previewResponse = await request(app)
      .post("/api/imports/preview")
      .attach("file", csv, "trading212-history.csv");

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.body.data.broker).toBe("TRADING212");
    expect(previewResponse.body.data.summary.itemCount).toBe(2);
    expect(previewResponse.body.data.summary.readyCount).toBe(2);
    expect(previewResponse.body.data.summary.invalidCount).toBe(0);
    expect(previewResponse.body.data.transactions).toHaveLength(2);

    const commitResponse = await request(app).post("/api/imports/commit").send({
      broker: previewResponse.body.data.broker,
      items: previewResponse.body.data.items,
    });

    expect(commitResponse.status).toBe(201);
    expect(commitResponse.body.data.importedItemCount).toBe(2);
    expect(commitResponse.body.data.transactionCount).toBe(2);

    const holdingsResponse = await request(app).get("/api/portfolio/holdings");
    expect(holdingsResponse.status).toBe(200);
    expect(holdingsResponse.body.data).toHaveLength(1);
    expect(holdingsResponse.body.data[0].symbol).toBe("AAPL");
    expect(holdingsResponse.body.data[0].quantity).toBe(1);

    const summaryResponse = await request(app).get("/api/portfolio/summary");
    expect(summaryResponse.status).toBe(200);
    expect(summaryResponse.body.data.totals.assetCount).toBe(1);

    const duplicatePreview = await request(app)
      .post("/api/imports/preview")
      .attach("file", csv, "trading212-history.csv");

    expect(duplicatePreview.status).toBe(200);
    expect(duplicatePreview.body.data.summary.duplicateCount).toBe(2);

    const duplicateCommit = await request(app).post("/api/imports/commit").send({
      broker: duplicatePreview.body.data.broker,
      items: duplicatePreview.body.data.items,
    });

    expect(duplicateCommit.status).toBe(400);
    expect(duplicateCommit.body.error.code).toBe("NO_IMPORTABLE_ROWS");
  });
});
