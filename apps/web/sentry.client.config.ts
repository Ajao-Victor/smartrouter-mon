import * as Sentry from '@sentry/nextjs';

/**
 * Browser error monitoring (PDF: Sentry). PII is never sent: prompts, addresses and hashes are
 * scrubbed from events and breadcrumbs (security.md §8). Disabled when no DSN is configured.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

const HEX = /0x[0-9a-fA-F]{40,64}/g;

function scrub(text: string): string {
  return text.replace(HEX, '0x…');
}

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    beforeSend(event) {
      if (event.message) event.message = scrub(event.message);
      if (event.request?.url) event.request.url = scrub(event.request.url);
      delete event.user;
      for (const ex of event.exception?.values ?? []) {
        if (ex.value) ex.value = scrub(ex.value);
      }
      return event;
    },
    beforeBreadcrumb(crumb) {
      // Never log prompt bodies or wallet traffic.
      if (crumb.category === 'fetch' || crumb.category === 'xhr') {
        const url = typeof crumb.data?.url === 'string' ? crumb.data.url : '';
        if (/\/run|\/quote|\/sessions/.test(url)) return null;
      }
      if (crumb.message) crumb.message = scrub(crumb.message);
      return crumb;
    },
  });
}
