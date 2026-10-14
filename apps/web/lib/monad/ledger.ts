/**
 * Optional on-chain receipts for ratings and Compare votes (backend `routes/requests.ts`): an
 * EIP-712 Rating / Vote signed by the spending key is relayed to SmartRouterLedger. Without a key
 * (or a known ledger) the rating is still saved, just off-chain.
 */
import type { TypedData } from '@/lib/api/types';

import { getContracts } from './contracts';
import { signWithSpendingKey } from './spendingKey';
import { ledgerDomain, RATING_TYPES, uuidToBytes16, VOTE_TYPES } from './typedData';

const typed = (primaryType: string, types: TypedData['types'], message: TypedData['message']): TypedData | null => {
  const { chainId, ledger } = getContracts();
  if (!ledger) return null;
  return { domain: ledgerDomain(chainId, ledger), types, primaryType, message };
};

/** Signature for `POST /feedback`, or undefined (no key / no ledger / signing failed). */
export async function signRating(address: string, requestId: string, score: 1 | -1): Promise<string | undefined> {
  try {
    const t = typed('Rating', RATING_TYPES as unknown as TypedData['types'], { requestId: uuidToBytes16(requestId), score: String(score) });
    return (t && (await signWithSpendingKey(address, t))) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Signature for `POST /compare/vote`, or undefined. */
export async function signVote(address: string, compareGroup: string, winnerRequestId: string, loserRequestId: string): Promise<string | undefined> {
  try {
    const t = typed('Vote', VOTE_TYPES as unknown as TypedData['types'], {
      compareGroup: uuidToBytes16(compareGroup),
      winnerRequestId: uuidToBytes16(winnerRequestId),
      loserRequestId: uuidToBytes16(loserRequestId),
    });
    return (t && (await signWithSpendingKey(address, t))) ?? undefined;
  } catch {
    return undefined;
  }
}
