# Monad Backend Gaps (frontend → backend)

These are points where `Monad.docx` doesn't settle how the frontend should behave. The frontend now targets the Monad API at `https://smartrouter-mon-77e0210bcfa8.herokuapp.com`. All payloads were read from `Wangsamuels/smartrouter-mon@d7ff1af` and checked against the live API. Each gap below says what the frontend does for now; the offline mocks in `apps/web/tests/mocks` follow the same behaviour.

Items are ordered from blocking to nice-to-have.

## 1. Needed before production login works

1. **`APP_ORIGINS`**: please add the production frontend origin, plus any Vercel preview origin we'll use. The current live frontend is `https://smart-router-h6hl.vercel.app`. Without it every request fails CORS.
2. **Privy app `cmv7760bf00ps0gl39z69z4e6` (smartmon)** needs these settings:
   - the same origins added as allowed domains;
   - identity tokens enabled ("Return user data in an identity token");
   - an embedded Ethereum wallet created on login;
   - Monad as the default chain.

   Please confirm each one; we can't check them from the frontend.
3. **Card funding on Monad**: `/wallet/options` → `card: { via: 'privy', chain: 'monad' }`. The frontend calls Privy `useFundWallet` with chain 143 and asset `USDC`. **Does the smartmon Privy app actually support card funding of USDC on Monad?** If not, we'll hide the Card tab. Today it's shown whenever `features.card` is set.

## 2. Spending key

4. **No revoke route.** The Tempo build revoked the access key on-chain. On Monad there is no `DELETE /wallet/spending-key` and no route that relays a vault `revokeSigner`. For now, "Remove key from this browser" only deletes the local key, and the vault keeps trusting it until `signerExpiry` (7 days). Could you add `POST /wallet/spending-key/revoke`? Either typed data to sign plus a relayed `setupFor` with an expired signer, or a dedicated revoke.
5. **`spendingKey.status: 'unknown'`** is returned when the vault state can't be read. The frontend then lets the run go through and relies on a 409 `SETUP_REQUIRED`. Please confirm that's the intended behaviour, and whether `unknown` can also mean "no vault row yet" for a brand-new user.
6. **Caps change → re-sign Setup.** `PATCH /me/settings` returns `vaultSetupNeeded: true`. The frontend then re-signs `GET /wallet/setup?signer=<same key>&dailyUsd=&weeklyUsd=` with the new caps. Please confirm that:
   - re-registering the same signer is allowed (the nonce increments);
   - it doesn't reset `signerExpiry` in a way you don't want.
7. **`SETUP_REQUIRED.details.setup.message.signer` is `null`.** The frontend ignores `details.setup` and always fetches `GET /wallet/setup?signer=<browser key>`. Please confirm that's correct, or have the 409 omit the typed data.

## 3. Paid runs (402 voucher)

8. **Checking the voucher base.** Before signing, the frontend checks four things:
   - the domain is chain 143 and the vault;
   - `message.user` is the user's wallet;
   - `details.priceUsd` is no higher than the quoted price;
   - it signs the server's `cumulativeAmount` as-is.

   It does not check `cumulativeAmount − nextVoucherBaseMicro == price`, because that would cost an extra `/sessions/current` call per answer. Could the 402 `details` include `baseMicro` (the previous total), so the client can check the increment itself?
9. **Concurrent paid runs.** The backend allows 3 concurrent runs per user. Cumulative vouchers mean two answers in flight could sign the same base. The frontend queues paid runs one at a time until the first one's payment step is done. Is a `mismatch` → second 402 the only failure mode? Should the client retry once on `Voucher rejected: expected cumulativeAmount …`? The handoff says to sign and retry once; we don't retry twice.
10. **`QUOTE_USED` and `SETUP_REQUIRED` both use HTTP 409**, and so does `EMAIL_REQUIRED`. The frontend maps on `code`, which is fine. Please always send `code` on 409s.

## 4. Deposits

11. **Aurora (other chains)** is now built on the frontend. The Deposit panel has three tabs: Monad, Other chains and Card.
    - It uses `@aurora-is-near/intents-connect` with the `/wallet/options → aurora` recipe as-is.
    - Create calls go through `POST /aurora/*` with `X-Session-Token`. Other calls go straight to `aurora.baseUrl`; the CSP allows `https://*.aurora.dev`.
    - The origin wallet is the Privy embedded wallet. It signs with `personal_sign` (erc191). The user then sends USDC to the one-time deposit address from any wallet (`depositViaWallet: false`).
    - Only EVM source chains are shown. Solana needs a Solana wallet, which we don't have.
    - Please confirm:
      - `AURORA_API_URL` is on an `*.aurora.dev` host;
      - `available` is `true` in production;
      - the worker credits the AI balance and flips the activity row from `pending` to `completed`.
12. **Deposit authorization TTL** is 1 hour (`validBefore`). The frontend signs right away, so this is fine. Just flagging that a slow signature (Privy modal left open) gets a `VALIDATION_FAILED` from the relay rather than a dedicated code.
13. **"Funds arrived" detection** compares `GET /wallet → main.balanceUsd` every 10 s. If Envio becomes available (`/health` shows `envio: false` today), a push or SSE for incoming USDC would be better.

## 5. Ratings and ledger

14. `Monad.docx` doesn't cover signed ratings, votes, `GET /leaderboard` or `GET /requests/:id/route`, so the frontend doesn't implement them. Ratings and votes are sent unsigned, as before. Tell us if they're needed.

## 6. Confirmations (no change needed unless you say so)

- `POST /auth/privy`, `/me`, `/chats*`, `/recommend`, `/catalog`, `/requests*` and `/uploads*` are unchanged apart from added fields (`network`, `spendingKey`, `router`, `routeHash`, `ledgerTx`). The frontend accepts all of them.
- `POST /relay`, `POST /wallet/spending-key`, `POST /wallet/deposit-address` and `POST /wallet/send/:id/submitted` are no longer called.
- Sends: `chain` is always `'monad'` and `token` is `'USDC'`.
- The session token is kept in `localStorage`, so a reload stays signed in, and is sent as `X-Session-Token`. The handoff example uses `sessionStorage`; tell us if you require that.
- The browser spending key is a raw secp256k1 private key in IndexedDB, as the handoff specifies. An XSS on the frontend origin could read it, but it can only spend the AI balance, within the caps, until it expires.
