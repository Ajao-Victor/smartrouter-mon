import type { TypedData } from '@/lib/api/types';

import { getContracts, resetContracts, setContracts } from '../contracts';
import { assertTypedData, toBody, toSignable, TypedDataMismatch } from '../typedData';

const USER = '0x00000000000000000000000000000000000000a1';
const vaultTyped = (over: Partial<TypedData> = {}): TypedData => ({
  domain: { name: 'SmartRouterVault', version: '1', chainId: 143, verifyingContract: getContracts().vault },
  types: {
    Voucher: [
      { name: 'user', type: 'address' },
      { name: 'cumulativeAmount', type: 'uint256' },
    ],
  },
  primaryType: 'Voucher',
  message: { user: USER, cumulativeAmount: '12000' },
  ...over,
});

afterEach(() => {
  resetContracts();
});

describe('Monad typed data', () => {
  it('turns uint fields into bigint for signing and keeps strings in the JSON body', () => {
    const t = vaultTyped();
    expect(toSignable(t)).toEqual({ user: USER, cumulativeAmount: 12000n });
    expect(toBody(t, '0xsig')).toEqual({ user: USER, cumulativeAmount: '12000', signature: '0xsig' });
  });

  it('refuses a field the type declares but the message lacks', () => {
    expect(() => toSignable(vaultTyped({ message: { user: USER } }))).toThrow(/missing cumulativeAmount/);
  });

  it('accepts the SmartRouter vault on Monad for the user’s own address', () => {
    expect(() => {
      assertTypedData(vaultTyped(), { primaryType: 'Voucher', contract: 'vault', field: 'user', address: USER.toUpperCase().replace('0X', '0x') });
    }).not.toThrow();
  });

  it('refuses another chain, another contract, another type or another user', () => {
    const check = (t: TypedData, address = USER) => () => {
      assertTypedData(t, { primaryType: 'Voucher', contract: 'vault', field: 'user', address });
    };
    expect(check(vaultTyped({ domain: { ...vaultTyped().domain, chainId: 4217 } }))).toThrow(TypedDataMismatch);
    expect(check(vaultTyped({ domain: { ...vaultTyped().domain, verifyingContract: '0x000000000000000000000000000000000000beef' } }))).toThrow(/unexpected contract/);
    expect(check(vaultTyped({ primaryType: 'Setup' }))).toThrow(/expected Voucher/);
    expect(check(vaultTyped(), '0x00000000000000000000000000000000000000b2')).toThrow(/not your wallet/);
  });

  it('follows the vault address the API reports', () => {
    const old = vaultTyped();
    const next = '0x1111111111111111111111111111111111111111';
    setContracts({ vault: next });
    expect(() => {
      assertTypedData(old, { primaryType: 'Voucher', contract: 'vault' });
    }).toThrow(/unexpected contract/);
    expect(() => {
      assertTypedData(vaultTyped({ domain: { ...vaultTyped().domain, verifyingContract: next } }), { primaryType: 'Voucher', contract: 'vault' });
    }).not.toThrow();
    setContracts({ vault: 'not-an-address' });
    expect(getContracts().vault).toBe(next);
  });
});
