import { Reveal } from '@/components/domain/marketing/reveal';
import { getLandingIcon } from '@/lib/landing-page/icon-registry';
import type { FlatLandingPageContent } from '@/lib/landing-page/flatten-content';

export function ModulesGrid({ modules }: { modules: FlatLandingPageContent['modules'] }) {
  return (
    <section id="modules" className="py-24 sm:py-32">
      <div className="container">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl lg:text-[2.75rem]">{modules.heading}</h2>
          <p className="mt-5 text-balance text-lg leading-relaxed text-muted-foreground">{modules.subheading}</p>
        </Reveal>

        <div className="mt-20 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {modules.items.map((module, i) => {
            const Icon = getLandingIcon(module.icon);
            return (
              <Reveal key={module.id} delayMs={i * 60}>
                <div className="group h-full rounded-2xl border border-border bg-card p-7 transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/[0.07]">
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-accent-foreground transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-semibold tracking-tight">{module.title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{module.description}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
