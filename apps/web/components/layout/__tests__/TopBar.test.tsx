import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';

import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';

import { Sidebar } from '../Sidebar';
import { TopBar } from '../TopBar';

vi.mock('next/navigation', () => ({ usePathname: () => '/chat/c1', useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/lib/api/endpoints', () => ({
  api: {
    chats: {
      list: () =>
        Promise.resolve({
          chats: [
            { id: 'c1', title: 'Cover letter for Paystack', taskType: 'writing', slider: null, currentModelId: null, updatedAt: new Date().toISOString(), createdAt: null, messageCount: 2, spentUsd: 0 },
            { id: 'c2', title: 'Old chat', taskType: 'chat', slider: null, currentModelId: null, updatedAt: '2026-01-01T00:00:00.000Z', createdAt: null, messageCount: 1, spentUsd: 0 },
          ],
          nextCursor: null,
        }),
      remove: vi.fn(),
    },
  },
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('TopBar', () => {
  it('renders the title, the right slot and opens the history drawer on phones', () => {
    useUiStore.setState({ sidebarOpen: false });
    render(<TopBar title="Cover letter for Paystack" right={<span>HUD</span>} />);
    expect(screen.getByText('Cover letter for Paystack')).toBeInTheDocument();
    expect(screen.getByText('HUD')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open chat history' }));
    expect(useUiStore.getState().sidebarOpen).toBe(true);
  });
});

describe('Sidebar (chat history on the left)', () => {
  it('lists chats grouped by day with the current one marked, plus New chat, Activity and Settings', async () => {
    useAuthStore.getState().signedIn({ userId: 'u', address: '0xabc', email: 'a@b.co', loginMethod: 'email' });
    wrap(<Sidebar />);
    const history = screen.getAllByRole('navigation', { name: 'Chat history' })[0];
    expect(history).toBeDefined();
    const current = await screen.findAllByRole('link', { name: 'Cover letter for Paystack' });
    expect(current[0]).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByText('Today')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Earlier')[0]).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New chat' })[0]).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Activity' })[0]).toHaveAttribute('href', '/activity');
    expect(screen.getAllByRole('link', { name: 'Settings' })[0]).toHaveAttribute('href', '/settings');
  });

  it('asks guests to sign in to keep their chats', () => {
    useAuthStore.getState().signedOut();
    wrap(<Sidebar />);
    expect(screen.getAllByText(/Sign in to keep your chats/)[0]).toBeInTheDocument();
  });
});
