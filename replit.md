# AI Betting Analyst Toolkit

A full-stack AI-powered sports betting intelligence platform: live odds, Gemini AI predictions, Telegram alerts, performance tracking, and a self-training feedback loop.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, proxied at /api)
- `pnpm --filter @workspace/dashboard run dev` — run the dashboard (port 23183, proxied at /)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run typecheck:libs` — build composite libs (run before api-server typecheck)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 — `artifacts/api-server`
- Dashboard: React + Vite + shadcn/ui + Recharts + wouter — `artifacts/dashboard`
- DB: PostgreSQL + Drizzle ORM — `lib/db`
- AI: Google Gemini 2.0 Flash via `@workspace/integrations-gemini-ai` — `lib/integrations-gemini-ai`
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec in `lib/api-spec/openapi.yaml`)
- Build: esbuild (ESM bundle for API server)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for all API contracts
- `lib/api-client-react/src/generated/api.ts` — generated TanStack Query hooks
- `lib/api-zod/src/generated/api.ts` — generated Zod validators
- `lib/db/src/schema/` — Drizzle table definitions (predictions, performance_metrics, training_records, conversations, messages)
- `artifacts/api-server/src/routes/` — Express route handlers (predictions, odds, telegram, metrics, training, gemini)
- `lib/integrations-gemini-ai/src/client.ts` — Gemini AI client (uses Genini_api direct key or AI_INTEGRATIONS proxy)

## Architecture decisions

- **Gemini client priority**: Uses `Genini_api` secret directly if set; falls back to `AI_INTEGRATIONS_GEMINI_*` proxy. This lets us switch without code changes.
- **Kelly criterion is capped at 20%** in the prediction route to prevent overexposure regardless of AI output.
- **Auto-metric recomputation**: Whenever a prediction result is marked, daily performance metrics are recomputed and a Telegram result notification is fired asynchronously — no manual refresh needed.
- **Self-calibrating prompts**: The prediction prompt includes recent win/loss outcomes to give Gemini live calibration context on each new prediction.
- **Contract-first API**: All endpoints are defined in OpenAPI first, then codegen produces hooks and validators. Never write raw fetch calls in the frontend.

## Product

- **Dashboard** (`/`) — Bloomberg-terminal dark UI. Overview metrics, recent signals, quick actions.
- **Predictions** (`/predictions`) — AI-generated match predictions with confidence, Kelly fraction, odds. Mark results to feed the training loop.
- **Live Odds** (`/odds`) — Live odds via The Odds API. Click any match to generate an AI prediction instantly.
- **Performance** (`/performance`) — Accuracy and ROI charts (Recharts), sport breakdown, training history log.
- **AI Analyst** (`/ai-analyst`) — Streaming Gemini chat with betting system prompt and persistent conversation history.

## User preferences

- Use Gemini API via `Genini_api` secret (direct key); AI_INTEGRATIONS proxy as fallback.
- Push to GitHub: `https://github.com/k89293676-creator/ai-betting-analyst-toolkit.git` using `Gbpat` secret.
- Telegram notifications: results + predictions via `TELEGRAM_BOTTOKEN` + `TELEGRAM_CHATID`.
- Never use console.log in server code — use req.log or logger.

## Gotchas

- Always run `pnpm run typecheck:libs` before `pnpm --filter @workspace/api-server run typecheck` — libs must be built first for declaration files to exist.
- After adding a new lib dependency to api-server, also add it to `artifacts/api-server/package.json` `dependencies` (not just the lib's package.json), because esbuild externalizes workspace lib packages and their deps must be resolvable at runtime.
- `@google/*` packages are in the esbuild external list — `@google/genai` must be a direct dependency of api-server.
- Express 5: wildcard routes use `/{*splat}`, params are `string | string[]`, always annotate async handlers `: Promise<void>`.
- Git push to GitHub: `git --no-optional-locks push "https://$Gbpat@github.com/k89293676-creator/ai-betting-analyst-toolkit.git" main --force`

## Pointers

- See `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `lib/api-spec/openapi.yaml` to add/modify endpoints, then run codegen
