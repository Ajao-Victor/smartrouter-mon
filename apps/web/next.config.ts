import path from 'node:path';

import type { NextConfig } from 'next';

/**
 * Content Security Policy — see security.md §4 and the handover ("Environments and config"). The
 * browser talks to the SmartRouter API, the public Tempo RPC (viem wallet client), Privy (sign-in
 * modal + embedded wallet iframe, Cloudflare Turnstile captcha) and Sentry. Provider MPP hosts never appear in this bundle
 * (`pnpm guard:hosts`). The API is called directly — never through a Vercel rewrite — so the
 * backend sees the real client IP and the `sr_session` cookie stays first-party.
 */
const isDev = process.env.NODE_ENV !== 'production';

const network = process.env.NEXT_PUBLIC_TEMPO_NETWORK === 'tempo' ? 'tempo' : 'moderato';
const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL ?? (network === 'tempo' ? 'https://rpc.tempo.xyz' : 'https://rpc.moderato.tempo.xyz');
const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? '';
const objectStorageHost = process.env.NEXT_PUBLIC_OBJECT_STORAGE_HOST ?? '';

const originOf = (u: string): string => {
  try {
    return u ? new URL(u).origin : '';
  } catch {
    return '';
  }
};

/** Privy's documented CSP origins (auth modal, embedded wallet iframe, RPC proxy, captcha, WalletConnect). */
const PRIVY = {
  connect: ['https://auth.privy.io', 'https://*.privy.io', 'https://*.rpc.privy.systems', 'wss://relay.walletconnect.com', 'wss://relay.walletconnect.org', 'https://explorer-api.walletconnect.com'],
  // Card deposits open Privy's checkout (MoonPay / Stripe).
  frame: ['https://auth.privy.io', 'https://verify.walletconnect.com', 'https://verify.walletconnect.org', 'https://challenges.cloudflare.com', 'https://*.moonpay.com', 'https://*.stripe.com'],
  script: ['https://challenges.cloudflare.com'],
};

/** File uploads go from the browser straight to Cloudflare R2 (presigned PUT from `POST /uploads`). */
const UPLOAD_STORAGE = ['https://*.r2.cloudflarestorage.com', 'https://*.eu.r2.cloudflarestorage.com'];
const connectSrc = ["'self'", originOf(apiUrl), originOf(rpcUrl), originOf(sentryDsn), ...PRIVY.connect, ...UPLOAD_STORAGE].filter(Boolean).join(' ');
const mediaSrc = ["'self'", 'blob:', objectStorageHost ? `https://${objectStorageHost}` : ''].filter(Boolean).join(' ');
const imgSrc = ["'self'", 'data:', 'blob:', objectStorageHost ? `https://${objectStorageHost}` : ''].filter(Boolean).join(' ');

const csp = [
  `default-src 'self'`,
  // three.js (landing field) needs wasm-unsafe-eval; Next dev needs unsafe-eval/unsafe-inline for HMR.
  `script-src 'self' 'wasm-unsafe-eval' ${PRIVY.script.join(' ')}${isDev ? " 'unsafe-eval' 'unsafe-inline'" : " 'unsafe-inline'"}`,
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
  `font-src 'self' https://fonts.gstatic.com data:`,
  `img-src ${imgSrc} https://auth.privy.io`,
  `media-src ${mediaSrc}`,
  `connect-src ${connectSrc}${isDev ? ' ws: wss: http://localhost:* http://127.0.0.1:*' : ''}`,
  `frame-src ${PRIVY.frame.join(' ')}`,
  `child-src ${PRIVY.frame.join(' ')}`,
  `worker-src 'self' blob:`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Privy may offer passkeys inside its modal (publickey-credentials-*); nothing else is granted.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self), publickey-credentials-get=(self), publickey-credentials-create=(self)' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Let CI/phase builds write elsewhere while `next dev` holds `.next` (e.g. NEXT_DIST_DIR=.next-build).
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // Sentry's OpenTelemetry hooks use dynamic require(); keep them external to silence the
  // "Critical dependency" warning without affecting the client bundle.
  serverExternalPackages: ['require-in-the-middle', '@opentelemetry/instrumentation', 'import-in-the-middle'],
  // Monorepo root for file tracing (silences the multiple-lockfile warning on Vercel).
  outputFileTracingRoot: path.join(__dirname, '../../'),
  images: {
    remotePatterns: objectStorageHost ? [{ protocol: 'https', hostname: objectStorageHost }] : [],
  },
  experimental: {
    // Trim the big icon/animation packages to what is imported.
    optimizePackageImports: ['lucide-react', 'motion'],
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
  webpack(config: { ignoreWarnings?: unknown[]; resolve?: { alias?: Record<string, unknown> } }) {
    // Privy's optional Farcaster/Solana mini-app peer is never used here (email + Google only).
    config.resolve = { ...config.resolve, alias: { ...config.resolve?.alias, '@farcaster/mini-app-solana': false } };
    config.ignoreWarnings = [...(config.ignoreWarnings ?? []), { module: /require-in-the-middle|import-in-the-middle|@opentelemetry/ }, { module: /virtualMasterPool/ }];
    return config;
  },
};

export default nextConfig;
