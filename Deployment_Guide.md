# SmartRouter web — Deployment Guide (Vercel)

Source of truth: *SmartRouter Frontend Architecture* (Oct 9, 2026), section "Deploy to Vercel", updated for
SmartRouter on Monad (`Monad.docx`). This guide turns those into a checklist for `apps/web`.

## 1. What gets deployed

| Item | Value |
|---|---|
| Framework | Next.js 15 (App Router), pnpm workspace, root manifest at the repo root |
| App directory | `apps/web` |
| Backend (Monad mainnet, chain 143) | `https://smartrouter-mon-77e0210bcfa8.herokuapp.com` (Heroku app `smartrouter-mon`) |
| Branch → environment | `main` → **production (Monad mainnet)**; previews use the same values |

The frontend never proxies the API through Vercel rewrites: the browser calls `NEXT_PUBLIC_API_URL`
directly with `credentials: 'include'`, so the backend sees the real client IP and the `sr_session`
cookie stays first-party. That is why the app and the API must live on the **same registrable domain**.

## 2. Domains and cookies (PDF)

| Role | Production | Staging |
|---|---|---|
| Frontend (Vercel) | `app.<domain>` | `staging.<domain>` |
| API (Heroku) | `api.<domain>` | `api-staging.<domain>` |

Backend `APP_ORIGINS` must list the exact frontend origins (scheme + host, no trailing slash); the first
entry is the SIWE domain. Vercel preview URLs are not in `APP_ORIGINS`, so previews cannot sign in
against the real API — point them at the mock API (`NEXT_PUBLIC_MOCK=1`) if you need working previews.

## 3. Vercel project settings

1. **Import** `Ajao-Victor/SmartRouter` → *Add New Project*.
2. **Root Directory**: `apps/web` (tick *Include source files outside of the Root Directory* so the
   workspace lockfile at the repo root is used).
3. **Framework preset**: Next.js (auto-detected). Node 22 (set in *Settings → General → Node.js Version*).
4. **Install command**: `pnpm install --frozen-lockfile` (runs at the workspace root automatically).
5. **Build command**: `pnpm build` (= `next build`). **Output**: default (`.next`).
6. **Production branch**: `main`. Create the `staging` branch and add it under *Settings → Git →
   Preview/Branch Deployments* so it gets its own stable URL (`staging.<domain>`).

`apps/web/vercel.json` pins the framework and commands so the UI settings cannot drift.

## 4. Environment variables

Set these in *Settings → Environment Variables*. They are the only values the browser needs (PDF
"Vercel environment variables"); everything is public and ships in the bundle.

| Variable | Value (Production and Preview) |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://smartrouter-mon-77e0210bcfa8.herokuapp.com` (or `https://api.<domain>` once DNS is live) |
| `NEXT_PUBLIC_CHAIN_ID` | `143` (Monad mainnet; also the default) |
| `NEXT_PUBLIC_RPC_URL` | `https://rpc.monad.xyz` (public RPC; also the default) |
| `NEXT_PUBLIC_PRIVY_APP_ID` | `cmv7760bf00ps0gl39z69z4e6` (Privy app `smartmon`) |

Remove `NEXT_PUBLIC_TEMPO_NETWORK` if it is still set: the Tempo build read it, this one doesn't. Tempo
is backend infrastructure only (SmartRouter's provider payments); the browser never touches it.
`bash apps/web/scripts/vercel-env.sh` sets all of this.

Optional:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_OBJECT_STORAGE_HOST` | Hostname of generated images/songs (next/image + CSP `img-src`/`media-src`) |
| `NEXT_PUBLIC_SENTRY_DSN` | Browser error monitoring (PII scrubbed; off when empty) |
| `NEXT_PUBLIC_FLAG_COMPARE`, `NEXT_PUBLIC_FLAG_MUSIC` | Feature flags, `1`/`0` (PDF cut order: Compare first, then music) |
| `NEXT_PUBLIC_MOCK` | **Never set on Vercel** (dev/test only — runs the app on the MSW mock API) |

Rules from the PDF:

- Use the **public** RPC URL. Never put a dRPC key URL (or any key) in a `NEXT_PUBLIC_*` variable.
- The frontend has no server-side secrets at all; there is nothing to add to *Encrypted* variables.

`apps/web/.env.example` documents the same keys; `apps/web/.env.local` / `.env` hold the testnet
values for local development (gitignored).

## 5. First deploy checklist

> **Build fails with `Invalid public environment … NEXT_PUBLIC_API_URL: Required`?** The four variables
> are missing in the Vercel project. `lib/env.ts` validates them at build time on purpose: `NEXT_PUBLIC_*`
> values are inlined into the bundle, so a build without them can only produce a broken or wrong-network
> app. Run `bash apps/web/scripts/vercel-env.sh` (after `npx vercel link`) to push the PDF values for
> production and the `staging` preview, then redeploy.


1. Push `main` (and `staging`). Vercel builds both.
2. Add the custom domains: `app.<domain>` → production, `staging.<domain>` → the `staging` branch.
3. On Heroku, set `APP_ORIGINS` on each API app to the matching frontend origin
   (`https://app.<domain>` for mainnet, `https://staging.<domain>` for testnet).
4. Open the staging URL: the yellow *Testnet · Moderato* strip must be visible, *Sign in with passkey*
   must create a passkey and land on `/chat` (that proves `/auth/challenge` + `/auth/verify` and the
   cookie work across `staging.` ↔ `api-staging.`).
5. Run a paid model once: the first run deposits the allocation (one passkey approval), the Send button
   price matches the receipt's `chargedUsd`, and the wallet sheet shows deposit / spent / remaining.
6. Check the browser console for CSP violations (`connect-src` is the API origin + the RPC origin + Sentry).
7. Promote to production only after the mainnet API's `APP_ORIGINS` includes `https://app.<domain>`.

## 6. Local verification before pushing

```bash
pnpm install
cd apps/web
pnpm lint && pnpm typecheck && pnpm test     # unit + mock-API tests
pnpm test:e2e                                # Playwright demo path on the mock API (mobile + desktop)
pnpm guard:hosts                             # no provider hosts in the bundle
NEXT_DIST_DIR=.next-build pnpm build         # production build (separate dir so `pnpm dev` keeps .next)
```

`pnpm dev` serves http://localhost:3300 against the testnet API from `.env.local`; set
`NEXT_PUBLIC_MOCK=1` there to work fully offline.

## 7. Rollback

Vercel keeps every deployment: *Deployments → ⋯ → Promote to Production* on the last good build. The
frontend holds no state of its own (cookies and payment sessions live with the API and the wallet), so
rolling back is safe at any time.
