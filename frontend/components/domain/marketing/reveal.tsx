'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Scroll-reveal wrapper for Landing Page sections — fades/slides content in
 * once it enters the viewport. Plain IntersectionObserver, no animation
 * library (see globals.css's ".reveal" utility for the actual CSS
 * transition; this component only toggles the class at the right time).
 * Respects prefers-reduced-motion via the CSS media query in globals.css,
 * not duplicated here.
 */
export function Reveal({
  children,
  className,
  delayMs = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delayMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          const t = setTimeout(() => setVisible(true), delayMs);
          observer.disconnect();
          return () => clearTimeout(t);
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [delayMs]);

  return (
    <div ref={ref} className={cn('reveal', visible && 'reveal-visible', className)}>
      {children}
    </div>
  );
}
