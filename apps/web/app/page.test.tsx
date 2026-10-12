import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';

import HomePage from './page';

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HomePage />
    </QueryClientProvider>,
  );
}

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/' }));
vi.mock('@/components/landing/LandingFx', () => ({ LandingFx: () => null }));

describe('HomePage (landing)', () => {
  it('renders the pitch, task chips, saving proof and coming-soon teasers', () => {
    renderHome();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Tell SmartRouter what you want done/);
    for (const label of ['Chat', 'Writing', 'Coding', 'Research', 'Translation', 'Image', 'Music']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText('82% of the best quality at half the price')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Naira via Paystack/ })).toBeInTheDocument();
    expect(screen.getAllByText('Quality data: LMArena, Artificial Analysis').length).toBeGreaterThanOrEqual(1);
  });

  it('routes Start a task to /chat and chips to a category', () => {
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Start a task' }));
    expect(push).toHaveBeenCalledWith('/chat');
    fireEvent.click(screen.getByRole('button', { name: 'Coding' }));
    expect(push).toHaveBeenCalledWith('/chat?category=coding');
  });
});
