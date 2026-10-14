'use client';

import { useEffect, useState } from 'react';

import dynamic from 'next/dynamic';

import { canUseWebGL } from '@/lib/motion/capabilities';
import { useReducedMotionSafe } from '@/lib/motion/useReducedMotionSafe';

import { selectActivity, useStreamStore } from '@/stores/streamStore';
import { useUiStore } from '@/stores/uiStore';

const RouterFieldScene = dynamic(() => import('@/components/fx/RouterFieldScene'), { ssr: false });

/**
 * Full-bleed backdrop (design.md §2 RouterField): a noise-displaced point field with
 * lit lanes when WebGL is available, else the CSS drifting-glow fallback. Pauses while
 * a wallet SDK dialog is open or the tab is hidden. Always behind content (z-field).
 */
export function RouterField() {
  const reduced = useReducedMotionSafe();
  const activity = useStreamStore(selectActivity);
  const sdkDialogOpen = useUiStore((s) => s.sdkDialogOpen);
  const [webgl, setWebgl] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [count, setCount] = useState(4000);

  useEffect(() => {
    setWebgl(canUseWebGL());
    setCount(window.innerWidth >= 1024 ? 12000 : 4000);
    const onVis = () => {
      setHidden(document.hidden);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return (
    <>
      <div className="bg-field-fallback pointer-events-none fixed inset-0 z-field" aria-hidden="true" />
      {webgl && !reduced && (
        <div className="pointer-events-none fixed inset-0 z-field" aria-hidden="true">
          <RouterFieldScene count={count} activity={activity} paused={sdkDialogOpen || hidden} />
        </div>
      )}
      <div className="bg-grid-field pointer-events-none fixed inset-0 z-field" aria-hidden="true" />
      <div className="bg-noise pointer-events-none fixed inset-0 z-field" aria-hidden="true" />
    </>
  );
}
