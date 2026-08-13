'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTraining } from './training-provider';
import { TrainingStepPopover } from './training-step-popover';

const CARD_WIDTH = 320;
const CARD_MARGIN = 16;
const SPOTLIGHT_PADDING = 6;

/**
 * Finds the real DOM element a step points at (`[data-tour="…"]`, a plain
 * attribute added to existing pages — see training/data-tour usages) and
 * tracks its bounding rect live. Retries for a couple seconds after route
 * changes since the target page still has to mount/fetch data before the
 * element exists; gives up rather than spinning forever if it never
 * appears (a step with a stale/renamed selector shouldn't hang the tour).
 */
function useTourTarget(selector: string | undefined) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!selector) {
      setRect(null);
      return;
    }
    let cancelled = false;
    let attempts = 0;
    let raf = 0;

    function measure() {
      if (cancelled) return;
      const el = document.querySelector(`[data-tour="${selector}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setRect(el.getBoundingClientRect());
        return;
      }
      attempts += 1;
      if (attempts < 120) {
        raf = requestAnimationFrame(measure);
      } else {
        setRect(null);
      }
    }
    measure();

    function onViewportChange() {
      const el = document.querySelector(`[data-tour="${selector}"]`);
      if (el) setRect(el.getBoundingClientRect());
    }
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);
    };
  }, [selector]);

  return rect;
}

function cardPosition(target: DOMRect | null): { top: number; left: number } {
  if (!target) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return { top: vh / 2 - 120, left: Math.max(CARD_MARGIN, vw / 2 - CARD_WIDTH / 2) };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const spaceRight = vw - target.right;
  const spaceBelow = vh - target.bottom;

  let left: number;
  let top: number;
  if (spaceRight >= CARD_WIDTH + CARD_MARGIN * 2) {
    left = target.right + CARD_MARGIN;
    top = Math.min(Math.max(target.top, CARD_MARGIN), vh - 260);
  } else if (spaceBelow >= 220) {
    top = target.bottom + CARD_MARGIN;
    left = Math.min(Math.max(target.left, CARD_MARGIN), vw - CARD_WIDTH - CARD_MARGIN);
  } else {
    top = Math.max(target.top - 240, CARD_MARGIN);
    left = Math.min(Math.max(target.left, CARD_MARGIN), vw - CARD_WIDTH - CARD_MARGIN);
  }
  return { top, left };
}

/**
 * Renders as a portal to <body> so it sits above the whole app regardless
 * of where TrainingProvider/this component are mounted in the tree.
 * Deliberately `pointer-events: none` on the dim/spotlight layer — the
 * real page underneath must stay fully clickable (Practice steps require
 * the user to actually operate the real UI); only the step card itself is
 * interactive.
 */
export function TrainingOverlay() {
  const { activeCourse, activeStep, activeStepIndex, next, back, exit, restartCourse } = useTraining();
  const rect = useTourTarget(activeStep?.targetSelector);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted || !activeCourse || !activeStep) return null;

  const pos = cardPosition(rect);

  return createPortal(
    <div className="fixed inset-0 z-[55]" aria-live="polite">
      {rect ? (
        <div
          className="pointer-events-none fixed rounded-md transition-all duration-200"
          style={{
            top: rect.top - SPOTLIGHT_PADDING,
            left: rect.left - SPOTLIGHT_PADDING,
            width: rect.width + SPOTLIGHT_PADDING * 2,
            height: rect.height + SPOTLIGHT_PADDING * 2,
            // Single box-shadow value combining both layers — an inline
            // `style.boxShadow` completely replaces (not merges with) any
            // box-shadow a Tailwind class like `ring-2` would otherwise
            // contribute, since both ultimately set the same CSS property.
            boxShadow: '0 0 0 3px hsl(var(--primary)), 0 0 0 9999px hsl(var(--background) / 0.7)',
          }}
        />
      ) : (
        <div className="pointer-events-none fixed inset-0 bg-background/70" />
      )}

      <TrainingStepPopover
        course={activeCourse}
        step={activeStep}
        stepIndex={activeStepIndex}
        onNext={next}
        onBack={back}
        onExit={exit}
        onRestart={() => restartCourse(activeCourse.id)}
        style={{ position: 'fixed', top: pos.top, left: pos.left, width: CARD_WIDTH }}
      />
    </div>,
    document.body,
  );
}
