import { Reveal } from '@/components/domain/marketing/reveal';
import { getLandingIcon } from '@/lib/landing-page/icon-registry';
import type { FlatLandingPageContent } from '@/lib/landing-page/flatten-content';

/** Large-numeral divided-row list — deliberately not another icon-card grid (modules-grid.tsx already owns that pattern); this section needs its own visual identity, not a repeat. */
export function Benefits({ content }: { content: FlatLandingPageContent['benefits'] }) {
  return (
    <section className="border-y border-border bg-secondary/30 py-24 sm:py-32">
      <div className="container">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl lg:text-[2.75rem]">{content.heading}</h2>
          <p className="mt-5 text-balance text-lg leading-relaxed text-muted-foreground">{content.subheading}</p>
        </Reveal>

        <div className="mx-auto mt-16 max-w-4xl divide-y divide-border border-t border-border">
          {content.items.map((benefit, i) => {
            const Icon = getLandingIcon(benefit.icon);
            return (
              <Reveal key={benefit.id} delayMs={i * 80}>
                <div className="grid grid-cols-1 items-center gap-4 py-8 sm:grid-cols-[auto_auto_1fr] sm:gap-8">
                  <span className="font-mono text-sm font-medium text-muted-foreground/60">{String(i + 1).padStart(2, '0')}</span>
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold tracking-tight">{benefit.title}</h3>
                    <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground">{benefit.description}</p>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
