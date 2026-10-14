import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'tests/e2e/**'],
    css: false,
    passWithNoTests: true,
    // lib/env.ts validates at import; give tests the Monad config with mocks on.
    env: {
      NEXT_PUBLIC_API_URL: 'http://localhost:8787',
      NEXT_PUBLIC_CHAIN_ID: '143',
      NEXT_PUBLIC_RPC_URL: 'https://rpc.monad.xyz',
      NEXT_PUBLIC_PRIVY_APP_ID: 'test-privy-app',
      NEXT_PUBLIC_MOCK: '1',
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
