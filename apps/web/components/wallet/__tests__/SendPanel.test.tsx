import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { walletSchema } from '@/lib/api/types';

import { server } from '@/tests/mocks/server';
import { MOCK_SEND_CODE, mockWallet, resetMockState } from '@/tests/mocks/state';

import { SendPanel } from '../SendPanel';

/**
 * Send, against the mock API. By default (live backend since Oct 13) there is no email code:
 * Review → Continue → signature. When the backend turns codes on (`features.sendCode.required`):
 * Review → Continue emails a code → six boxes → the sixth digit submits.
 */
const wallet = walletSchema.parse({
  address: '0x5b9da9fa5d210691948de6f9cf6bf97fa4e8cf5b',
  network: { chainId: 42431, name: 'Tempo Testnet (Moderato)' },
  token: { address: '0x20c0000000000000000000000000000000000000', symbol: 'pathUSD', decimals: 6 },
  main: { balanceUsd: 12.5 },
  features: { sendCode: { required: true, sentTo: 'd•••@smartrouter.dev', ttlMinutes: 10 } },
});
const TO = '0x1111111111111111111111111111111111111111';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
});
afterEach(() => {
  server.resetHandlers();
  resetMockState();
});
afterAll(() => {
  server.close();
});

function setup(w = wallet) {
  const onDone = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SendPanel wallet={w} onBack={vi.fn()} onDone={onDone} />
    </QueryClientProvider>,
  );
  return { onDone };
}

const typeCode = (code: string) => {
  fireEvent.paste(screen.getByLabelText('Digit 1'), { clipboardData: { getData: () => code } });
};

async function toCodeScreen() {
  fireEvent.change(screen.getByLabelText('To address'), { target: { value: TO } });
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  expect(await screen.findByText(/We'll email a code to d•••@smartrouter.dev/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByText(/Enter the 6-digit code we sent to d•••@smartrouter.dev/)).toBeInTheDocument();
}

describe('SendPanel: no email code (features.sendCode.required: false)', () => {
  const noCodes = walletSchema.parse({ ...wallet, features: { sendCode: { required: false, sentTo: null, ttlMinutes: 10 } } });

  it('Continue goes straight to the send: no code screen, no email, no countdown', async () => {
    const { onDone } = setup(noCodes);
    fireEvent.change(screen.getByLabelText('To address'), { target: { value: TO } });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0.10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    await screen.findByRole('button', { name: 'Continue' });
    expect(screen.queryByText(/email a code/)).toBeNull();
    expect(screen.getByText(/^One signature\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });
    expect(screen.queryByText(/6-digit code/)).toBeNull();
    expect(screen.queryByText(/Resend code/)).toBeNull();
    expect(mockWallet.sendCode).toBeNull();
    expect(mockWallet.balanceUsd).toBeCloseTo(12.4, 6);
  });

  it('an account without email can still send when codes are off', () => {
    setup(noCodes);
    expect(screen.queryByText('Add an email to your account to send money out.')).toBeNull();
  });

  it('a missing sendCode feature means no codes', () => {
    setup(walletSchema.parse({ ...wallet, features: {} }));
    expect(screen.queryByText(/email/i)).toBeNull();
  });
});

describe('SendPanel: email code before a send (features.sendCode.required: true)', () => {
  beforeEach(() => {
    mockWallet.sendCodeRequired = true;
  });

  it('Continue emails a code; the right code (pasted) sends', async () => {
    const { onDone } = setup();
    await toCodeScreen();
    expect(screen.getByText(/0x1111…1111/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resend code in \d+ s/ })).toBeDisabled();
    typeCode(MOCK_SEND_CODE);
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });
    expect(mockWallet.balanceUsd).toBeCloseTo(10.5, 6);
  });

  it('a wrong code says how many tries are left and clears the boxes', async () => {
    setup();
    await toCodeScreen();
    typeCode('000000');
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong code — 4 tries left');
    expect(screen.getByLabelText('Digit 1')).toHaveValue('');
  });

  it('five wrong codes → expired, with a Send new code button that works', async () => {
    const { onDone } = setup();
    await toCodeScreen();
    for (let i = 0; i < 4; i += 1) {
      typeCode('000000');
      await screen.findByText(new RegExp(`${String(4 - i)} tr(y|ies) left`));
    }
    typeCode('000000');
    expect(await screen.findByText("This code has expired. We'll send a new one.")).toBeInTheDocument();
    // The cooldown between codes is the server's job; the mock has none.
    fireEvent.click(screen.getByRole('button', { name: 'Send new code' }));
    await waitFor(() => {
      expect(screen.queryByText(/expired/)).not.toBeInTheDocument();
    });
    typeCode(MOCK_SEND_CODE);
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });
  });

  it('an account without email is asked to add one before sending', () => {
    setup(walletSchema.parse({ ...wallet, features: { sendCode: { required: true, sentTo: null, ttlMinutes: 10 } } }));
    expect(screen.getByText('Add an email to your account to send money out.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add an email' })).toBeInTheDocument();
  });
});
