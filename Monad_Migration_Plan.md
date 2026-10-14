# Monad Migration Plan

Source of truth: `Monad.docx`, the frontend handoff for SmartRouter on Monad mainnet (chain `143`). Where the doc names backend source files (`apps/api/src/routes/{auth,wallet,run}.ts`, `packages/shared/src/typed-data.ts`), the exact payloads below were read from those files in `Wangsamuels/smartrouter-mon` (commit `d7ff1af`). They were also checked against the live API at `https://smartrouter-mon-77e0210bcfa8.herokuapp.com`, where `/health` reports `monad-mainnet`, chain 143.

## 0. What changes, in one paragraph

The backend is the same SmartRouter API, now running on Monad. Chats, catalogue, quotes, requests, uploads and the SSE stream keep their shapes; the changes there are additions only. Two things change. First, the user's chain moves from Tempo to Monad: wallet, balance, caps, receipts and explorer. Second, the payment rails are replaced. Tempo access keys, mppx session deposits and the `/relay` fee sponsor are gone. In their place:

- an EIP-712 **Setup** signature that registers a browser spending key and caps in `SmartRouterVault`;
- an ERC-3009 **ReceiveWithAuthorization** deposit that moves Circle USDC into the AI balance;
- a 402 **voucher challenge** on `POST /run`.

Tempo now only pays AI providers on the backend side, and the user never sees it.

## 1. Endpoints: old to new

| Old (Tempo) | New (Monad) | Action |
|---|---|---|
| `POST /auth/privy { identityToken }` | unchanged | keep; already sends the identity token |
| `GET /me` | `+ network { chainId, name }`, `+ spendingKey { setupDone, address, expiresAt }`, `allocation` = vault account | extend schema |
| `PATCH /me/settings` → `spendingKeyLimitUsd` | → `vaultSetupNeeded: boolean` | after a cap change, re-sign Setup |
| `GET /sessions/current` → `network { chainId, token, recipient, operator }` | `network { chainId, name, token, vault, ledger, operator, explorer }`; `session { …, nextVoucherBaseMicro, setupDone, signer, signerExpiresAt }` | extend schema |
| `GET /wallet` → `locked`, `spendingKey.setup` (Tempo access-key limits), `features.card: boolean` | `ai`/`locked` = AI balance, `vault`, `spendingKey { status, address, expiresAt, onChainCaps }`, `features.card: object` | schema rewrite (**`features.card` would break parsing today**) |
| `POST /wallet/spending-key { accessKeyAddress }` | **removed**, replaced by `GET /wallet/setup?signer=` then `POST /wallet/setup { ...message, signature }` | rewrite |
| on-chain `accessKey.updateLimit` after a cap change | re-sign `GET /wallet/setup?signer=&dailyUsd=&weeklyUsd=` | rewrite |
| on-chain `accessKey.revoke` | **no endpoint**, so the key is forgotten locally (see gaps) | reduce to local forget |
| mppx `sessionManager` (deposit plus voucher) | `POST /wallet/deposit/authorization { amountUsd }`, sign, then `POST /wallet/deposit { ...message, signature }` | new "Move to AI balance" flow |
| `POST /wallet/deposit-address` (bridges, Base card) | **removed**. Deposit = Monad address (direct); card = Privy funding on Monad; other chains = Aurora (`/aurora/*`) | Monad tab plus card; Aurora gap |
| `POST /wallet/send` → `{ sendId, calls[], feePayer }` + `/relay` + `POST /wallet/send/:id/submitted` | `POST /wallet/send` → `{ sendId, typedData (TransferWithAuthorization) }`, then `POST /wallet/send/:id/sign { signature }` | rewrite |
| `POST /wallet/send/quote`, `/wallet/send/code` | unchanged (`chain` is now the literal `monad`) | keep |
| `POST /wallet/locked/return` | unchanged (now releases the AI balance from the vault) | keep, relabel |
| `GET /wallet/activity` | `+ explorerUrl`, new type `to_ai_balance` / `from_ai_balance` / `answers_settled` | extend copy |
| `POST /relay` | **404** | delete |
| `POST /run` via mppx `manager.fetch` | `POST /run`, then **402 PAYMENT_REQUIRED `details.voucher`**; sign with the spending key; retry with `X-SmartRouter-Voucher: base64({cumulativeAmount, signature})`; read SSE | rewrite paid fetch |
| `POST /feedback`, `POST /compare/vote` | `+ signature?` (EIP-712 Rating / Vote, spending key) | sign when a key exists |
| `POST /recommend`, `POST /chats` | `+ router { source, routeHash, ms }` | optional field |
| `GET /requests/:id` | `+ routeHash`, `+ ledgerTx` | optional fields (receipt) |
| none | `GET /ledger`, `GET /leaderboard`, `GET /requests/:id/route` | typed endpoints added |

New error code: `SETUP_REQUIRED` (409, `details.setup` = typed data). Meanings that changed:

- `PAYMENT_REQUIRED` is now the voucher challenge.
- `ALLOCATION_EXHAUSTED` now means the AI balance is too low (`details.shortfallUsd`), so the UI shows the deposit flow.

## 2. Authentication and wallet connection

| Step | Before | After |
|---|---|---|
| Privy app | `cmv3ikdu600ml0fl9xtzfhbvh` | `cmv7760bf00ps0gl39z69z4e6` (`smartmon`), via `NEXT_PUBLIC_PRIVY_APP_ID` |
| Privy chain | Tempo (4217 / 42431) | `monad` from `viem/chains`, as `defaultChain` and the only `supportedChains` entry |
| Ready gate | `ready && authenticated` | `ready && walletsReady && authenticated` before exchanging (doc §3) |
| Exchange | identity token → `/auth/privy` → `X-Session-Token` | unchanged, plus an in-flight guard (kept) |
| Signing wallet | `wallets.find(walletClientType === 'privy')` | the embedded wallet **whose address equals `/auth/privy.address`**, switched to chain 143 |
| Signing method | `secp256k1_sign` raw hashes into a Tempo account | `eth_signTypedData_v4` through a viem wallet client on Monad |
| Spending key | WebCrypto P-256 Tempo access key | secp256k1 key from `viem/accounts`, kept in IndexedDB per wallet, never sent to the API |
| Card funding | Privy `fundWallet` on Base USDC to a bridge address | Privy `fundWallet` on Monad USDC to the user's own address |

## 3. Stores

- **`allocationStore`**: today it mirrors an mppx deposit. It becomes the **AI balance** (vault account): `depositUsd`, `spentUsd`, `remainingUsd`, plus `vault`, `nextVoucherBaseMicro`, `setupDone`, `explorer`. The Tempo `token` comment goes; `token` is now Circle USDC. `chosenDepositUsd` stays and becomes the amount the deposit dialog suggests moving into the AI balance.
- **`authStore`**: unchanged in shape. The comment changes to "Monad wallet".
- **`usageStore`**, `composerStore`, `streamStore`, `uiStore`: unchanged.

## 4. Code layout

- `lib/tempo/*` is deleted. `lib/monad/` replaces it:
  - `chain.ts`: the viem `monad` chain on `NEXT_PUBLIC_RPC_URL`.
  - `typedData.ts`: a port of `packages/shared/src/typed-data.ts`, plus a uuid→bytes16 helper.
  - `privyWallet.ts`: wallet selection by address, `switchChain(143)`, `signTypedData`.
  - `spendingKey.ts`: generate, store, load and forget the key; `registerSpendingKey` (Setup).
  - `payments.ts`: paid `/run` with a 402 voucher and one retry, a domain/user/amount guard before signing, and a one-at-a-time queue.
  - `walletActions.ts`: deposit to the AI balance, send.
  - `paymentErrors.ts`: wallet rejection → `PAYMENT_CANCELLED`.
- `mppx` is removed from dependencies. `viem/tempo` is no longer imported.
- `env.ts`: `NEXT_PUBLIC_TEMPO_NETWORK` is removed. `NEXT_PUBLIC_CHAIN_ID` defaults to `143` and `NEXT_PUBLIC_RPC_URL` to `https://rpc.monad.xyz`.
- `explorer.ts`: Monadscan (`https://monadscan.com`), with `network.explorer` from the API preferred when known.
- UI copy: Tempo becomes Monad; USDC.e and pathUSD become USDC; testnet, faucet and pathUSD UI are removed (mainnet only). Tempo is described only as backend provider-payment infrastructure (doc §8).
- MSW mocks (`tests/mocks`) gain `/wallet/setup`, `/wallet/deposit*`, `/wallet/send/:id/sign`, the 402 voucher challenge on `/run`, and `SETUP_REQUIRED`.

## 5. Order of work (one atomic commit per step)

1. env, chain, explorer
2. API types (schemas)
3. API endpoints and error codes
4. `lib/monad`: typed data, wallet, spending key, payments, wallet actions; delete `lib/tempo`
5. SSE paid fetch and `useRun` error handling
6. Hooks: `useWallet`, `useSettings`, `useWalletBalance`, `useAuth`, `useSession`
7. AuthProvider (Monad, wallets-ready gate)
8. Stores
9. Wallet UI: Deposit (Move to AI balance), Send, spending key, sheet, activity
10. Copy (landing, layout, settings, banners)
11. Mocks and tests
12. Remove mppx; validation (`pnpm lint`, `pnpm typecheck`, `pnpm test`)
