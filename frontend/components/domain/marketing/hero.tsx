import Link from 'next/link';
import { ArrowRight, MessageCircle, Boxes, Globe, ShieldCheck } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Reveal } from '@/components/domain/marketing/reveal';
import { HeroScreenshot } from '@/components/domain/marketing/hero-screenshot';
import { landingMediaUrl } from '@/lib/landing-page/media-url';
import type { FlatLandingPageContent } from '@/lib/landing-page/flatten-content';

/**
 * Real, verifiable facts, not invented business metrics ("128 active
 * orders" etc. are exactly what the ТЗ forbids) — module count and locale
 * count are structural facts about this codebase itself, RLS is a real
 * architecture decision already stated in the Benefits section's own copy.
 * Fills the space under the CTA with something true rather than empty air
 * while heroImageId is still unset (Phase 3).
 */
const TRUST_FACTS = [
  { icon: Boxes, label: '8 реальних модулів' },
  { icon: Globe, label: '4 мови інтерфейсу' },
  { icon: ShieldCheck, label: 'PostgreSQL Row-Level Security' },
];

export function Hero({ content }: { content: FlatLandingPageContent['hero'] }) {
  const imageUrl = landingMediaUrl(content.heroImageId);

  return (
    <section id="product" className="relative overflow-hidden pb-24 pt-20 sm:pb-32 sm:pt-28 lg:pt-40">
      {/* Soft radial glow + a subtle dot-grid texture underneath it — the
          combination (not the glow alone) is what reads as a considered,
          expensive surface rather than a plain gradient background; both
          pure CSS, no image asset. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-20 [background-image:radial-gradient(hsl(var(--foreground)/0.06)_1px,transparent_1px)] [background-size:28px_28px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black_40%,transparent_100%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[620px] w-[1000px] -translate-x-1/2 rounded-full bg-primary/[0.16] blur-[140px] dark:bg-primary/[0.22]"
      />

      <div className="container">
        <Reveal className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
            <span className="flex h-1.5 w-1.5 rounded-full bg-success" />
            {content.eyebrow}
          </div>

          {/* Solid brand-purple on the highlighted span, not a two-color gradient — a gradient text treatment reads as template-y for a premium B2B product. */}
          <h1 className="text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-[4.5rem]">
            {content.headline}
          </h1>

          <p className="mt-7 max-w-xl text-balance text-lg leading-relaxed text-muted-foreground sm:text-xl">{content.subheadline}</p>

          <div className="mt-11 flex flex-col items-center gap-3 sm:flex-row">
            {/*
              Deliberately a plain <Link className={buttonVariants(...)}>, NOT
              <Button asChild><Link>...</Link></Button> — that combination
              (Radix Slot cloning a next/link Client Component from inside a
              Server Component page) throws "Slot failed to slot onto its
              children" during `next build`'s static-generation pass. Real,
              reproduced bug (isolated to a 3-line repro), not a style
              preference.
            */}
            <Link href={content.primaryCta.href} className={buttonVariants({ size: 'lg', className: 'h-12 w-full px-7 text-[15px] sm:w-auto' })}>
              {content.primaryCta.label}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            <a href={content.secondaryCta.href} className={buttonVariants({ size: 'lg', variant: 'outline', className: 'h-12 w-full px-7 text-[15px] sm:w-auto' })}>
              <MessageCircle className="mr-2 h-4 w-4" />
              {content.secondaryCta.label}
            </a>
          </div>

          <p className="mt-5 text-xs text-muted-foreground">{content.microcopy}</p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-7 gap-y-3 border-t border-border pt-7">
            {TRUST_FACTS.map(({ icon: Icon, label }) => (
              <span key={label} className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Icon className="h-3.5 w-3.5 text-primary/70" />
                {label}
              </span>
            ))}
          </div>
        </Reveal>

        {/* No fabricated mockup here even while heroImageId is unset (Phase 3 — real screenshots — is a separate, disclosed follow-up): honest absence over a fake dashboard. */}
        {imageUrl && (
          <Reveal delayMs={150} className="mt-20 sm:mt-24">
            <HeroScreenshot src={imageUrl} alt={content.headline} />
          </Reveal>
        )}
      </div>
    </section>
  );
}
