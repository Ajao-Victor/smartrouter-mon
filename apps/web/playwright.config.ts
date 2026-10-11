import { defineConfig, devices } from '@playwright/test';

/**
 * E2E on mocks. By default boots its own `next dev` on port 3100 with a separate build dir
 * (`.next-e2e`) so it never collides with a developer's `pnpm dev` on 3300.
 * Override with E2E_PORT / PLAYWRIGHT_BASE_URL.
 */
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${String(port)}`;
// `E2E_VIDEO=1` records every run at the demo-script resolution (1280×800, docs/demo-script.md).
const record = process.env.E2E_VIDEO === '1';

export default defineConfig({
  testDir: './tests/e2e',
  // Routes are compiled once in global-setup; the budget still leaves room for a slow laptop.
  globalSetup: './tests/e2e/global-setup.ts',
  // Dev compiles each route on first visit; Privy makes those compiles slow on a laptop.
  timeout: 300_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    ...(record ? { video: { mode: 'on', size: { width: 1280, height: 800 } } } : {}),
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `pnpm exec next dev -p ${String(port)}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    // Privy makes the first compile of `/` slow on a cold dev server (minutes on a laptop).
    timeout: 420_000,
    env: {
      NEXT_PUBLIC_MOCK: '1',
      NEXT_PUBLIC_API_URL: 'http://localhost:8787',
      NEXT_PUBLIC_TEMPO_NETWORK: 'moderato',
      NEXT_PUBLIC_CHAIN_ID: '42431',
      NEXT_PUBLIC_RPC_URL: 'https://rpc.moderato.tempo.xyz',
      NEXT_PUBLIC_PRIVY_APP_ID: 'test-privy-app',
      NEXT_DIST_DIR: '.next-e2e',
    },
  },
});
