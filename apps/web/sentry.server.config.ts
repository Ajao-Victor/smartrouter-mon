import * as Sentry from '@sentry/nextjs';

/** Next server/edge runtime monitoring. The web app serves static pages; errors here are rare. */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0.05,
  });
}
