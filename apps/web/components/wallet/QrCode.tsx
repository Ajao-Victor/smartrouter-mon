'use client';

import { useEffect, useState } from 'react';

/** QR code for a deposit address (rendered locally to an SVG data URL — nothing leaves the browser). */
export function QrCode({ value, size = 168, label }: { value: string; size?: number; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import('qrcode')
      .then((q) => q.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }))
      .then((svg) => {
        if (!cancelled) setSrc(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);
  if (!src) return <div className="rounded-lg bg-white" style={{ width: size, height: size }} aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} width={size} height={size} alt={label} className="rounded-lg bg-white p-1" />;
}
