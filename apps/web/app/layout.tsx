import type { Metadata, Viewport } from 'next';

import { fontVariables } from '@/lib/fonts';

import { TestnetBanner } from '@/components/layout/TestnetBanner';

import { Providers } from './providers';

import './globals.css';

export const metadata: Metadata = {
  title: 'SmartRouter',
  applicationName: 'SmartRouter',
  description:
    'Tell SmartRouter what you want done. It picks the best AI for your budget, and you pay per use in USDC on Monad, from anywhere.',
  // PWA (PDF: "PWA later") — installable shell; no service worker yet (MSW's worker is dev-only).
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: { capable: true, title: 'SmartRouter', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  themeColor: '#05060A',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" data-scroll-behavior="smooth" className={fontVariables}>
      <body>
        <Providers>
          <TestnetBanner />
          {children}
        </Providers>
      </body>
    </html>
  );
}
