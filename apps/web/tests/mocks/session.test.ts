import { paidFetch } from '@/lib/tempo/session';

import { server } from './server';
import { resetMockState } from './state';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  server.resetHandlers();
  resetMockState();
});
afterAll(() => {
  server.close();
});

describe('mock-mode session calls', () => {
  it('paid runs go through the API helper on mocks (the spending key signs on live)', async () => {
    const res = await paidFetch('/sessions/current', undefined, '0xabc');
    expect(res.ok).toBe(true);
  });
});
