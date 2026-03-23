# AGENTS

## Purpose

Portfolio-tracker is a local-first portfolio application with an Express/Prisma backend and a Vite/React frontend.
Changes should preserve reliable import flows, correct portfolio math, and a UI that degrades safely when external data is missing.

## Project Rules

- Backend integrations live behind service abstractions in `src/lib`.
- LLM access is centralized in `src/lib/llm`.
- Application code must call the exported LLM service or backend routes that use it. Do not call OpenAI or any other LLM provider directly from feature code.
- Provider-specific details such as API base URL, model, temperature, max tokens, and API key must come from environment variables.
- If the LLM provider changes in the future, contain that change to the adapter implementation and config wiring.
- Secrets must never be hardcoded in source, tests, or committed example payloads.

## Workflow

- Before shipping backend changes, run `npm test`.
- Before shipping frontend changes, run `npm --prefix frontend run test`.
- Update `.env.example` whenever backend configuration changes.
- Keep AGENTS guidance in sync when architecture constraints change, especially for shared integration layers such as market data or LLM services.
