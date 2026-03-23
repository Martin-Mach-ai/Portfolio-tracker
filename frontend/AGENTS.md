# AGENTS

## Frontend Scope

The frontend renders portfolio data, imports, and dashboards from backend APIs. It should stay presentation-focused and avoid embedding backend integration details.

## Integration Rules

- The frontend must not call OpenAI or any other LLM provider directly.
- Any future AI feature must go through backend endpoints that themselves use the shared backend LLM service.
- Chat UI should send the current user message plus client-maintained conversation history to `POST /api/chat`.
- The frontend should not assume the backend stores conversation history.
- Keep UI copy and empty states explicit when backend data is missing or incomplete.

## Workflow

- Run `npm --prefix frontend run test` after frontend changes.
- Preserve existing API contracts unless the backend and frontend are updated together in the same change.
