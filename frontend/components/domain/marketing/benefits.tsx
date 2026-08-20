import { Reveal } from '@/components/domain/marketing/reveal';
import { getLandingIcon } from '@/lib/landing-page/icon-registry';
import type { FlatLandingPageContent } from '@/lib/landing-page/flatten-content';

export function Benefits({ content }: { content: FlatLandingPageContent['benefits'] }) {
  return (
    <section className="border-y border-border bg-secondary/30 py-20 sm:py-28">
      <div className="container">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{content.heading}</h2>
            <p className="mt-4 max-w-lg text-lg text-muted-foreground">{content.subheading}</p>
          </Reveal>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {content.items.map((benefit, i) => {
              const Icon = getLandingIcon(benefit.icon);
              return (
                <Reveal key={benefit.id} delayMs={i * 80}>
                  <div className="flex gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold">{benefit.title}</h3>
                      <p className="mt-1.5 text-sm text-muted-foreground">{benefit.description}</p>
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
