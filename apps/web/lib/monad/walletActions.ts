/**
 * Money moves on Monad, all gasless (Monad handoff §5.4 and the wallet routes): the Privy wallet
 * signs an ERC-3009 authorization and SmartRouter's operator submits it, paying the MON gas.
 *
 * - Top up the AI balance: `POST /wallet/deposit/authorization { amountUsd }` → sign
 *   ReceiveWithAuthorization → `POST /wallet/deposit { ...message, signature }`.
 * - Send USDC: `POST /wallet/send` → sign TransferWithAuthorization → `POST /wallet/send/:id/sign`.
 *
 * Each authorization is checked first: Monad's chain, Circle USDC, the user as `from`, and (for
 * deposits) the SmartRouter vault as `to`, (for sends) the recipient and amount the user typed.
 */
import { api } from '@/lib/api/endpoints';
import type { DepositResult, RelayedTx, SendRequest } from '@/lib/api/types';
import { fromUsd } from '@/lib/money';

import { getContracts, sameAddress } from './contracts';
import { signWithPrivy } from './privyWallet';
import { assertTypedData, toBody, TypedDataMismatch } from './typedData';

/** Move `amountUsd` of USDC from the main wallet into the AI balance. */
export async function depositToAiBalance(address: string, amountUsd: number): Promise<DepositResult> {
  const typed = await api.wallet.depositAuthorization(amountUsd);
  assertTypedData(typed, { primaryType: 'ReceiveWithAuthorization', contract: 'usdc', field: 'from', address });
  if (!sameAddress(String(typed.message.to), getContracts().vault)) throw new TypedDataMismatch('the deposit does not go to the SmartRouter vault');
  if (String(typed.message.value) !== String(fromUsd(amountUsd))) throw new TypedDataMismatch('the deposit amount differs from what you entered');
  const signature = await signWithPrivy(address, typed);
  return api.wallet.deposit(toBody(typed, signature));
}

/** Send USDC on Monad to another address (with the emailed code when the backend requires it). */
export async function sendUsdc(address: string, input: SendRequest): Promise<RelayedTx> {
  const plan = await api.wallet.send(input);
  const typed = plan.typedData;
  assertTypedData(typed, { primaryType: 'TransferWithAuthorization', contract: 'usdc', field: 'from', address });
  if (!sameAddress(String(typed.message.to), input.to)) throw new TypedDataMismatch('the recipient differs from what you entered');
  if (String(typed.message.value) !== String(fromUsd(input.amountUsd))) throw new TypedDataMismatch('the amount differs from what you entered');
  const signature = await signWithPrivy(address, typed);
  return api.wallet.signSend(plan.sendId, signature);
}
