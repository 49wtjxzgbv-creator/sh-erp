import { cn } from '@/lib/utils';

/**
 * "потрібно додати якусь полоску з відсотком завантаження щоб людина
 * розуміла що сайт не завис" (2026-10-09): a real, moving indicator for
 * long operations (big GLB download, per-part analysis) that otherwise
 * just show a static "завантаження..." sentence for tens of seconds on a
 * slow mobile connection — easy to mistake for a frozen page. `percent`
 * omitted renders an indeterminate (no fixed width) bar for a phase whose
 * progress genuinely isn't measurable yet.
 */
export function ProgressBar({ percent, className }: { percent?: number; className?: string }) {
  const clamped = percent == null ? null : Math.max(0, Math.min(100, percent));
  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-secondary', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped ?? undefined}
    >
      <div
        className={cn('h-full rounded-full bg-primary transition-[width] duration-200', clamped == null && 'w-1/3 animate-pulse')}
        style={clamped == null ? undefined : { width: `${clamped}%` }}
      />
    </div>
  );
}
