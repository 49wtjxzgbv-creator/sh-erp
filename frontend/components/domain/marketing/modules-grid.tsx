import { Reveal } from '@/components/domain/marketing/reveal';
import { getLandingIcon } from '@/lib/landing-page/icon-registry';
import { cn } from '@/lib/utils';
import type { FlatLandingPageContent } from '@/lib/landing-page/flatten-content';

/**
 * Bento-style asymmetric grid, not a uniform card wall — the first two
 * items (by sortOrder, whatever the admin currently has first) get a
 * larger "feature" treatment; the rest sit in the regular grid underneath.
 * Handles any item count gracefully (the module list is admin-editable),
 * it just stops treating items as "featured" past the first two.
 */
export function ModulesGrid({ modules }: { modules: FlatLandingPageContent['modules'] }) {
  const [featured, rest] = [modules.items.slice(0, 2), modules.items.slice(2)];

  return (
    <section id="modules" className="py-24 sm:py-32">
      <div className="container">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-balance text-3xl font-semibold tracking-tight sm:text-4xl lg:text-[2.75rem]">{modules.heading}</h2>
          <p className="mt-5 text-balance text-lg leading-relaxed text-muted-foreground">{modules.subheading}</p>
        </Reveal>

        <div className="mt-20 grid grid-cols-1 gap-5 lg:grid-cols-2">
          {featured.map((module, i) => {
            const Icon = getLandingIcon(module.icon);
            return (
              <Reveal key={module.id} delayMs={i * 60}>
                <div className="group relative h-full overflow-hidden rounded-2xl border border-border bg-card p-9 transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/[0.07]">
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/[0.06] blur-2xl transition-opacity duration-300 group-hover:opacity-150"
                  />
                  <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="font-display text-xl font-semibold tracking-tight">{module.title}</h3>
                  <p className="mt-3 max-w-md leading-relaxed text-muted-foreground">{module.description}</p>
                </div>
              </Reveal>
            );
          })}
        </div>

        <div className={cn('mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2', rest.length >= 3 && 'lg:grid-cols-3')}>
          {rest.map((module, i) => {
            const Icon = getLandingIcon(module.icon);
            const isLast = i === rest.length - 1;
            // The module list is admin-editable (an admin can add/hide/reorder
            // items any time — this grid just broke for real the day a 9th
            // module was added, leaving one card alone on its own row). Rather
            // than hardcode for today's count, detect a genuine remainder at
            // each breakpoint's own column count and let only a REAL orphan
            // span the full row, centered — an evenly-divisible count (e.g. 6
            // or 8) is left completely untouched.
            const spansSm = isLast && rest.length % 2 === 1;
            const spansLg = isLast && rest.length >= 3 && rest.length % 3 === 1;
            return (
              <Reveal key={module.id} delayMs={i * 60} className={cn(spansSm && 'sm:col-span-2', spansLg && 'lg:col-span-3')}>
                <div
                  className={cn(
                    'group h-full rounded-2xl border border-border bg-card p-7 transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/[0.05]',
                    (spansSm || spansLg) && 'sm:mx-auto sm:max-w-sm lg:max-w-md',
                  )}
                >
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-accent-foreground transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-display font-semibold tracking-tight">{module.title}</h3>
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
