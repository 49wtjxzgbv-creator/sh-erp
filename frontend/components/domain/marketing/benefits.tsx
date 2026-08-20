import { Reveal } from '@/components/domain/marketing/reveal';
import { getLandingIcon } from '@/lib/landing-page/icon-registry';
import type { FlatLandingPageContent } from '@/lib/landing-page/flatten-content';

export function Benefits({ content }: { content: FlatLandingPageContent['benefits'] }) {
  return (
    <section className="border-y border-border bg-secondary/30 py-24 sm:py-32">
      <div className="container">
        <div className="grid grid-cols-1 gap-14 lg:grid-cols-2 lg:gap-20">
          <Reveal>
            <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl lg:text-[2.75rem]">{content.heading}</h2>
            <p className="mt-5 max-w-lg text-balance text-lg leading-relaxed text-muted-foreground">{content.subheading}</p>
          </Reveal>

          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
            {content.items.map((benefit, i) => {
              const Icon = getLandingIcon(benefit.icon);
              return (
                <Reveal key={benefit.id} delayMs={i * 80}>
                  <div className="flex gap-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold tracking-tight">{benefit.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{benefit.description}</p>
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
