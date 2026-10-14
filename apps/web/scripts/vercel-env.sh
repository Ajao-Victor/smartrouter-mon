#!/usr/bin/env bash
# Push the public variables from the Monad handoff ("Required production configuration") to the
# linked Vercel project. Everything here is public (NEXT_PUBLIC_*), so nothing sensitive is stored.
# SmartRouter runs on Monad mainnet only, so Production and Preview get the same values.
#
# Usage, from the repo root after `npx vercel link` (root directory apps/web):
#   bash apps/web/scripts/vercel-env.sh
#   API_URL=https://api.example.com bash apps/web/scripts/vercel-env.sh
set -euo pipefail

API_URL="${API_URL:-https://smartrouter-mon-77e0210bcfa8.herokuapp.com}"
# Privy app "smartmon" (public id, not the secret).
PRIVY_APP_ID="${PRIVY_APP_ID:-cmv7760bf00ps0gl39z69z4e6}"

add() { # name value environment
  local name="$1" value="$2" env="$3"
  # Replace an existing value so the script is safe to re-run.
  npx vercel env rm "$name" "$env" --yes >/dev/null 2>&1 || true
  printf '%s' "$value" | npx vercel env add "$name" "$env"
}

for target in production preview; do
  echo "== $target (Monad mainnet, chain 143)"
  add NEXT_PUBLIC_API_URL      "$API_URL"                 "$target"
  add NEXT_PUBLIC_CHAIN_ID     "143"                      "$target"
  add NEXT_PUBLIC_RPC_URL      "https://rpc.monad.xyz"    "$target"
  add NEXT_PUBLIC_PRIVY_APP_ID "$PRIVY_APP_ID"            "$target"
  # The Tempo build's variable: no longer read.
  npx vercel env rm NEXT_PUBLIC_TEMPO_NETWORK "$target" --yes >/dev/null 2>&1 || true
done

echo
echo "Done. Verify with: npx vercel env ls"
echo "Never add NEXT_PUBLIC_MOCK on Vercel. Add each frontend origin to APP_ORIGINS on Heroku and in Privy."
