'use client';

import { useEffect, useRef } from 'react';

import { clsx } from 'clsx';
import { AnimatePresence, motion, type PanInfo, type Variants } from 'motion/react';

import { useFocusTrap } from '@/lib/a11y/useFocusTrap';
import { dragPhysics } from '@/lib/motion/springs';
import { useReducedMotionSafe } from '@/lib/motion/useReducedMotionSafe';
import { backdrop as backdropVariants, withReduced } from '@/lib/motion/variants';

import { useUiStore } from '@/stores/uiStore';

import { Portal } from '@/components/ui/Portal';

export interface OverlayProps {
  open: boolean;
  onClose: () => void;
  /** Panel variants (slideUpSheet, slideRightDrawer, dialog …). */
  variants: Variants;
  /** z-index utility class (z-drawer | z-sheet). */
  zClass: 'z-drawer' | 'z-sheet';
  /** Layout wrapper classes: positions the panel inside the fixed layer. */
  layoutClass: string;
  /** Panel classes. */
  panelClass: string;
  /** Enable drag-to-dismiss along an axis. */
  drag?: 'y' | 'x';
  labelledBy?: string;
  children: React.ReactNode;
}

/**
 * Shared overlay engine: portal, dimmed glass backdrop, focus trap, Escape, body scroll lock,
 * optional velocity-based drag dismiss (design.md "Sheet physics"). Never rendered above
 * wallet SDK dialogs (architecture.md §7): if an SDK dialog is open we don't mount at all.
 */
export function Overlay({
  open,
  onClose,
  variants,
  zClass,
  layoutClass,
  panelClass,
  drag,
  labelledBy,
  children,
}: OverlayProps) {
  const reduced = useReducedMotionSafe();
  const sdkDialogOpen = useUiStore((s) => s.sdkDialogOpen);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const visible = open && !sdkDialogOpen;

  useFocusTrap(panelRef, visible);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [visible, onClose]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const axis = drag ?? 'y';
    const velocity = axis === 'y' ? info.velocity.y : info.velocity.x;
    const offset = axis === 'y' ? info.offset.y : info.offset.x;
    const size = axis === 'y' ? (panelRef.current?.offsetHeight ?? 1) : (panelRef.current?.offsetWidth ?? 1);
    if (velocity > dragPhysics.dismissVelocity || offset > size * dragPhysics.dismissTravel) onClose();
  };

  const dragProps =
    drag && !reduced
      ? {
          drag,
          dragConstraints: { top: 0, bottom: 0, left: 0, right: 0 },
          dragElastic: dragPhysics.dragElastic,
          dragTransition: dragPhysics.dragTransition,
          onDragEnd,
        }
      : {};

  return (
    <Portal>
      <AnimatePresence>
        {visible && (
          <div className={clsx('fixed inset-0', zClass)}>
            <motion.div
              aria-hidden="true"
              className="absolute inset-0 bg-bg-0/70 backdrop-blur-sm"
              variants={backdropVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              onClick={onClose}
            />
            <div className={clsx('pointer-events-none absolute inset-0', layoutClass)}>
              <motion.div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                {...(labelledBy ? { 'aria-labelledby': labelledBy } : {})}
                tabIndex={-1}
                className={clsx('pointer-events-auto outline-none', panelClass)}
                variants={withReduced(variants, reduced)}
                initial="hidden"
                animate="visible"
                exit="exit"
                {...dragProps}
              >
                {children}
              </motion.div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </Portal>
  );
}
