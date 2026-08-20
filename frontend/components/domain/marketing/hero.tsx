import Link from 'next/link';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Reveal } from '@/components/domain/marketing/reveal';
import { HeroScreenshot } from '@/components/domain/marketing/hero-screenshot';
import { landingMediaUrl } from '@/lib/landing-page/media-url';
import type { FlatLandingPageContent } from '@/lib/landing-page/flatten-content';

export function Hero({ content, mediaUrls }: { content: FlatLandingPageContent['hero']; mediaUrls: Record<string, string> }) {
  const imageUrl = landingMediaUrl(mediaUrls, content.heroImageId);

  return (
    <section id="product" className="relative overflow-hidden pb-20 pt-16 sm:pb-28 sm:pt-24">
      {/* Soft radial glow behind the headline — Stripe/Linear-style ambient background, pure CSS, no image asset. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px] dark:bg-primary/25"
      />

      <div className="container">
        <Reveal className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm">
            <span className="flex h-1.5 w-1.5 rounded-full bg-success" />
            {content.eyebrow}
          </div>

          {/* Solid brand-purple on the highlighted span, not a two-color gradient — a gradient text treatment reads as template-y for a premium B2B product. */}
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl">
            {content.headline}
          </h1>

          <p className="mt-6 max-w-2xl text-balance text-lg text-muted-foreground sm:text-xl">{content.subheadline}</p>

          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
            {/*
              Deliberately a plain <Link className={buttonVariants(...)}>, NOT
              <Button asChild><Link>...</Link></Button> — that combination
              (Radix Slot cloning a next/link Client Component from inside a
              Server Component page) throws "Slot failed to slot onto its
              children" during `next build`'s static-generation pass. Real,
              reproduced bug (isolated to a 3-line repro), not a style
              preference.
            */}
            <Link href={content.primaryCta.href} className={buttonVariants({ size: 'lg', className: 'w-full sm:w-auto' })}>
              {content.primaryCta.label}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            <a href={content.secondaryCta.href} className={buttonVariants({ size: 'lg', variant: 'outline', className: 'w-full sm:w-auto' })}>
              <MessageCircle className="mr-2 h-4 w-4" />
              {content.secondaryCta.label}
            </a>
          </div>

          <p className="mt-4 text-xs text-muted-foreground">{content.microcopy}</p>
        </Reveal>

        {/* No fabricated mockup here even while heroImageId is unset (Phase 3 — real screenshots — is a separate, disclosed follow-up): honest absence over a fake dashboard. */}
        {imageUrl && (
          <Reveal delayMs={150} className="mt-16 sm:mt-20">
            <HeroScreenshot src={imageUrl} />
          </Reveal>
        )}
      </div>
    </section>
  );
}
