# SmartRouter — web app (`apps/web`)

Next.js 15 (App Router) frontend for SmartRouter: tell it what you want done, it quotes the best AI
models for your budget, and you pay per use from your Tempo wallet via MPP (`mppx`).

The backend contract is *SmartRouter Frontend Architecture* (Oct 9, 2026). Everything the app calls is
in `lib/api/endpoints.ts`; the SSE reader for `POST /run` is `lib/api/sse.ts`; payments are in
`lib/tempo/` (viem passkey account → access key → `mppx` session manager).

## Run

```bash
pnpm install                       # from the repo root (pnpm workspace)
cd apps/web
pnpm dev                           # http://localhost:3300 — .env.local points at the testnet API (Moderato)
```

Set `NEXT_PUBLIC_MOCK=1` in `.env.local` to run fully offline against the MSW mock API
(`tests/mocks/`), which implements the same contract. Dev-only galleries: `/dev/tokens`, `/dev/primitives`, `/dev/fx`.

## Checks

| Command | What |
|---|---|
| `pnpm lint` | ESLint (strict type-checked, a11y, import order, no `localStorage`, no timers in payment code) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest + Testing Library + the mock-API contract tests |
| `pnpm test:e2e` | Playwright demo path on mocks (mobile + desktop) |
| `pnpm guard:hosts` | Fails if any MPP provider host appears in the frontend |
| `scripts/ci.sh` | All of the above plus `pnpm build` |

## Environment

Four public values (Monad handoff): `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CHAIN_ID` (143, Monad
mainnet), `NEXT_PUBLIC_RPC_URL` (public RPC only, default `https://rpc.monad.xyz`) and
`NEXT_PUBLIC_PRIVY_APP_ID`. Optional: object-storage host, Sentry DSN, feature flags
(`FLAG_COMPARE`, `FLAG_MUSIC`), `MOCK`. No keys of any kind exist in this app. See `.env.example` and
`../../Deployment_Guide.md`.

## How a turn works (PDF "A normal turn")

1. The draft is quoted while you type: `POST /chats/:id/quote { prompt, modelId? }` → price on the Send button.
2. Send → `POST /run { quoteId, prompt }`. Free quotes use plain `fetch`; paid quotes go through the
   `mppx` session manager (first paid run deposits the allocation with one passkey approval, then
   vouchers are signed silently by the access key).
3. SSE events `meta` → `delta`… → `done { chargedUsd }` (or `fallback`, `pending`, `error`) drive the
   stream store; `/sessions/current` is refreshed after each `done`.
4. Allocation used → *Top up* / *Continue free* inline; failed answers are never charged.

## Content Security Policy

`next.config.ts` emits a CSP whose `connect-src` is the API origin, the RPC origin and Sentry;
`frame-src 'none'` (passkeys are native WebAuthn prompts, not iframes). Check the browser console on
staging for violations after changing any origin.

## Monitoring

Sentry initialises only when `NEXT_PUBLIC_SENTRY_DSN` is set. `sendDefaultPii` is off; prompts,
wallet traffic breadcrumbs and hex addresses/hashes are scrubbed before send.
