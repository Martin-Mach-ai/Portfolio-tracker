import "dotenv/config";

import cors from "cors";
import express from "express";

import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { assetsRouter } from "./routes/assets";
import { chatRouter } from "./routes/chat";
import { healthRouter } from "./routes/health";
import { importsRouter } from "./routes/imports";
import { portfolioRouter } from "./routes/portfolio";
import { transactionsRouter } from "./routes/transactions";

export const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.use("/health", healthRouter);
app.use("/api/assets", assetsRouter);
app.use("/api/chat", chatRouter);
app.use("/api/imports", importsRouter);
app.use("/api/transactions", transactionsRouter);
app.use("/api/portfolio", portfolioRouter);

app.use(notFoundHandler);
app.use(errorHandler);
