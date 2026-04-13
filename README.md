# Portfolio Tracker

Express and Prisma backend with a Vite + React frontend for tracking investment assets,
transactions, holdings, and portfolio summary data.

## Setup

1. Install dependencies with `npm install`
2. Install frontend dependencies with `npm --prefix frontend install`
3. Copy `.env.example` to `.env`
4. Run `npm run prisma:migrate -- --name init`
5. Start both apps with `npm run dev`

The API runs on `http://localhost:3000` and the frontend runs on `http://localhost:5173`.
Vite proxies `/api` and `/health` to the backend during development.

## Scripts

- `npm run dev` starts the API and frontend together
- `npm run dev:api` starts the API in watch mode
- `npm run dev:web` starts the frontend dev server
- `npm run build` compiles TypeScript to `dist`
- `npm run build:web` builds the frontend
- `npm run build:all` builds the backend and frontend
- `npm start` runs the compiled server
- `npm run prisma:generate` regenerates the Prisma client
- `npm run prisma:migrate -- --name init` applies local database migrations
- `npm test` runs the API test suite against a separate SQLite test database
- `npm run test:web` runs the frontend test suite
