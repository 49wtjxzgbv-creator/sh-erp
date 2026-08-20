import { Reveal } from '@/components/domain/marketing/reveal';
import { getLandingIcon } from '@/lib/landing-page/icon-registry';
import type { FlatLandingPageContent } from '@/lib/landing-page/flatten-content';

export function ModulesGrid({ modules }: { modules: FlatLandingPageContent['modules'] }) {
  return (
    <section id="modules" className="py-20 sm:py-28">
      <div className="container">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{modules.heading}</h2>
          <p className="mt-4 text-lg text-muted-foreground">{modules.subheading}</p>
        </Reveal>

        <div className="mt-16 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {modules.items.map((module, i) => {
            const Icon = getLandingIcon(module.icon);
            return (
              <Reveal key={module.id} delayMs={i * 60}>
                <div className="group h-full rounded-xl border border-border bg-card p-6 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-accent text-accent-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-semibold">{module.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{module.description}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
