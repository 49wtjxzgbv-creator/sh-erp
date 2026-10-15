import Image from 'next/image';
import { ShoppingCart, PackageSearch, Truck, Handshake, PackageCheck, Lock, Factory, Send, ImageIcon, type LucideIcon } from 'lucide-react';
import { Reveal } from '@/components/domain/marketing/reveal';
import { cn } from '@/lib/utils';

/**
 * Keyed by the 8 fixed step ids seeded in INITIAL_LANDING_PAGE_CONTENT
 * (landing-page-content.types.ts) — falls back to the old plain ImageIcon
 * for any id this map doesn't recognize (an admin-added step, or a future
 * 9th step), so this never breaks, it just degrades to the previous look.
 */
const STEP_ICONS: Record<string, LucideIcon> = {
  order: ShoppingCart,
  'shortage-reservation': PackageSearch,
  procurement: Truck,
  'supplier-portal': Handshake,
  receiving: PackageCheck,
  'auto-reservation': Lock,
  production: Factory,
  shipment: Send,
};

export function ShowcaseStep({
  id,
  index,
  title,
  description,
  imageUrl,
  reverse,
}: {
  id: string;
  index: number;
  title: string;
  description: string;
  imageUrl: string | null;
  reverse: boolean;
}) {
  const StepIcon = STEP_ICONS[id] ?? ImageIcon;

  return (
    <Reveal className={cn('grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-20', reverse && 'lg:[direction:rtl]')}>
      <div className={cn(reverse && 'lg:[direction:ltr]')}>
        <span className="text-sm font-semibold tracking-wide text-primary">{String(index).padStart(2, '0')}</span>
        <h3 className="mt-3 text-2xl font-semibold tracking-tight sm:text-[1.75rem]">{title}</h3>
        <p className="mt-3.5 max-w-md text-balance leading-relaxed text-muted-foreground">{description}</p>
      </div>

      <div className={cn('overflow-hidden rounded-2xl border border-border bg-card shadow-xl shadow-primary/[0.06]', reverse && 'lg:[direction:ltr]')}>
        {imageUrl ? (
          <Image src={imageUrl} alt={title} width={1200} height={750} className="h-auto w-full" loading="lazy" />
        ) : (
          // Honest placeholder, not a fabricated screenshot — real screenshots
          // are a separate, disclosed follow-up (Phase 3 of the
          // implementation plan) captured from actual product UI. Still, 8 of
          // these in a row as a flat gray box was the single weakest spot on
          // the page visually — same dot-grid+glow language as the hero, a
          // step-specific icon, and a giant watermark numeral make each of
          // the 8 placeholders distinct and "considered" rather than 8
          // identical empty rectangles.
          <div className="relative flex aspect-[16/10] items-center justify-center overflow-hidden bg-secondary/20">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 [background-image:radial-gradient(hsl(var(--foreground)/0.07)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_70%_70%_at_50%_50%,black_30%,transparent_100%)]"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute select-none font-mono text-[7rem] font-bold leading-none text-foreground/[0.05] sm:text-[9rem]"
            >
              {String(index).padStart(2, '0')}
            </span>
            <span className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary sm:h-20 sm:w-20">
              <StepIcon className="h-7 w-7 sm:h-9 sm:w-9" />
            </span>
          </div>
        )}
      </div>
    </Reveal>
  );
}
