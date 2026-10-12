/**
 * The embedded wallet as a viem-signed Tempo account (fix for "insufficient funds … have 0"):
 * Privy only signs hashes (`secp256k1_sign`); the public key is recovered once and cached.
 */
import type { Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount, sign } from 'viem/accounts';

const store = new Map<string, unknown>();
vi.mock('@/lib/idb', () => ({
  idb: {
    get: (k: string) => Promise.resolve(store.get(k)),
    set: (k: string, v: unknown) => {
      store.set(k, v);
      return Promise.resolve();
    },
    del: (k: string) => {
      store.delete(k);
      return Promise.resolve();
    },
  },
}));

import { getPrivyAccount, registerPrivyWallets } from '../privyWallet';

function fakePrivy(privateKey: Hex, address: string) {
  const methods: string[] = [];
  const provider = {
    request: ({ method, params }: { method: string; params?: unknown[] }) => {
      methods.push(method);
      if (method !== 'secp256k1_sign') return Promise.reject(new Error(`unsupported ${method}`));
      return sign({ hash: params?.[0] as Hex, privateKey, to: 'hex' });
    },
  };
  registerPrivyWallets(() => [{ address, walletClientType: 'privy', getEthereumProvider: () => Promise.resolve(provider) }]);
  return methods;
}

beforeEach(() => {
  store.clear();
  registerPrivyWallets(null);
});

describe('getPrivyAccount', () => {
  it('no Privy wallet → UNAUTHENTICATED', async () => {
    await expect(getPrivyAccount()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('builds a Tempo root account for the wallet; Privy only signs raw hashes', async () => {
    const pk = generatePrivateKey();
    const eoa = privateKeyToAccount(pk);
    const methods = fakePrivy(pk, eoa.address);
    const account = await getPrivyAccount();
    expect(account.address.toLowerCase()).toBe(eoa.address.toLowerCase());
    expect(account.source).toBe('root');
    expect(typeof account.signKeyAuthorization).toBe('function');
    expect(methods).toEqual(['secp256k1_sign']);
  });

  it('caches the public key: no extra signature the next time', async () => {
    const pk = generatePrivateKey();
    const eoa = privateKeyToAccount(pk);
    const methods = fakePrivy(pk, eoa.address);
    await getPrivyAccount();
    await getPrivyAccount();
    expect(methods).toHaveLength(1);
    expect(store.get(`sr:pubkey:${eoa.address.toLowerCase()}`)).toMatch(/^0x04[0-9a-f]{128}$/);
  });

  it('a signer that is not this wallet → mismatch error, and the cache is dropped', async () => {
    const other = generatePrivateKey();
    const eoa = privateKeyToAccount(generatePrivateKey());
    fakePrivy(other, eoa.address);
    await expect(getPrivyAccount()).rejects.toThrow('Wallet signer mismatch');
    expect(store.size).toBe(0);
  });
});
