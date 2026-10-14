import type { AuroraRecipe } from '@/lib/api/types';

import { AMOUNT_PLACEHOLDER, auroraSourceChains, buildAuroraSteps, findOriginUsdc, toAtomic, toAuroraPhase } from '../aurora';

const USDC = '0x754704bc059f8c67012fed69bc8a327a5aafb603';
const VAULT = '0x88191be828c5ce6bda1c7796fb32450a10c3e54c';
const USER = `0x${'ab'.repeat(20)}`;

const recipe: AuroraRecipe = {
  available: true,
  baseUrl: 'https://intents-connect.aurora.dev',
  apiKeyProxyPath: '/aurora/',
  flow: 'bridge-in',
  type: 'evm',
  destination: { chain: 'monad', chainId: 143, assetId: 'nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx', tokenAddress: USDC },
  steps: [
    { to: USDC, functionSignature: 'approve(address,uint256)', parameters: [VAULT, AMOUNT_PLACEHOLDER], value: '0' },
    { to: VAULT, functionSignature: 'depositFor(address,uint256)', parameters: [USER, AMOUNT_PLACEHOLDER], value: '0' },
  ],
  chains: [
    { chain: 'base', name: 'Base' },
    { chain: 'arb', name: 'Arbitrum' },
    { chain: 'sol', name: 'Solana' },
  ],
  metadata: { title: 'Top up SmartRouter AI balance', intent: 'smartrouter_deposit' },
  note: '',
};

describe('Aurora recipe helpers', () => {
  it('templates the amount into approve(vault) and depositFor(user) only', () => {
    expect(buildAuroraSteps(recipe, AMOUNT_PLACEHOLDER)).toEqual(recipe.steps);
    const steps = buildAuroraSteps(recipe, '20000000');
    expect(steps.map((s) => s.parameters)).toEqual([
      [VAULT, '20000000'],
      [USER, '20000000'],
    ]);
  });

  it('offers EVM source chains only (the Privy wallet cannot sign for Solana)', () => {
    expect(auroraSourceChains(recipe).map((c) => c.chain)).toEqual(['base', 'arb']);
  });

  it('converts USD to atomic units', () => {
    expect(toAtomic(20, 6)).toBe('20000000');
    expect(toAtomic(1.5, 6)).toBe('1500000');
    expect(toAtomic(2, 18)).toBe('2000000000000000000');
  });

  it('finds USDC on the origin chain', () => {
    const tokens = [
      { blockchain: 'base', symbol: 'ETH', assetId: 'nep141:base.omft.near', contractAddress: '0x0', decimals: 18 },
      { blockchain: 'base', symbol: 'USDC', assetId: 'nep141:base-0x833589.omft.near', contractAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    ];
    expect(findOriginUsdc(tokens, 'base')).toEqual({ assetId: 'nep141:base-0x833589.omft.near', contractAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 });
    expect(findOriginUsdc(tokens, 'arb')).toBeNull();
  });

  it('collapses the SDK lifecycle into panel phases', () => {
    expect(toAuroraPhase('resolving-identity')).toBe('preparing');
    expect(toAuroraPhase('creating')).toBe('preparing');
    expect(toAuroraPhase('awaiting-signature')).toBe('signing');
    expect(toAuroraPhase('submitting')).toBe('signing');
    expect(toAuroraPhase('awaiting-deposit')).toBe('awaiting-deposit');
    expect(toAuroraPhase('settling')).toBe('settling');
    expect(toAuroraPhase('success')).toBe('success');
  });
});
