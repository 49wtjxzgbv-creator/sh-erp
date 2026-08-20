import Link from 'next/link';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Reveal } from '@/components/domain/marketing/reveal';
import { HeroScreenshot } from '@/components/domain/marketing/hero-screenshot';
import { landingMediaUrl } from '@/lib/landing-page/media-url';
import type { FlatLandingPageContent } from '@/lib/landing-page/flatten-content';

export function Hero({ content }: { content: FlatLandingPageContent['hero'] }) {
  const imageUrl = landingMediaUrl(content.heroImageId);

  return (
    <section id="product" className="relative overflow-hidden pb-24 pt-20 sm:pb-32 sm:pt-28 lg:pt-36">
      {/* Soft radial glow behind the headline — Stripe/Linear-style ambient background, pure CSS, no image asset. */}
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
          <h1 className="text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-[4.25rem]">
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
