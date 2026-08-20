import Link from 'next/link';
import { Check } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Reveal } from '@/components/domain/marketing/reveal';
import { cn } from '@/lib/utils';
import type { FlatLandingPageContent } from '@/lib/landing-page/flatten-content';
import type { LandingPagePlan } from '@/lib/landing-page/types';

/**
 * Price/limits come live from real seeded `Plan` rows (prisma/seed.ts),
 * never invented marketing numbers — the editor only controls
 * description/CTA-label/feature-bullet copy per tier, matched by
 * `Plan.key`, never the price itself. See landing-page-content.types.ts's
 * own header comment for why this split is deliberate.
 */
export function Pricing({ content, plans }: { content: FlatLandingPageContent['pricing']; plans: LandingPagePlan[] }) {
  const overrideByKey = new Map(content.tierCopyOverrides.map((o) => [o.planKey, o]));

  return (
    <section id="pricing" className="py-20 sm:py-28">
      <div className="container">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{content.heading}</h2>
          <p className="mt-4 text-lg text-muted-foreground">{content.subheading}</p>
        </Reveal>

        <div className="mx-auto mt-16 grid max-w-5xl grid-cols-1 gap-6 lg:grid-cols-3">
          {plans.map((plan, i) => {
            const override = overrideByKey.get(plan.key);
            const highlighted = plan.key === content.highlightedPlanKey;
            const price = Number(plan.monthlyPriceEur);
            return (
              <Reveal key={plan.id} delayMs={i * 80}>
                <div
                  className={cn(
                    'flex h-full flex-col rounded-2xl border p-8',
                    highlighted ? 'border-primary bg-card shadow-xl shadow-primary/10' : 'border-border bg-card',
                  )}
                >
                  {highlighted && (
                    <span className="mb-4 w-fit rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                      Популярний вибір
                    </span>
                  )}
                  <h3 className="text-lg font-semibold">{plan.name}</h3>
                  {override && <p className="mt-1.5 text-sm text-muted-foreground">{override.description}</p>}
                  <div className="mt-6 flex items-baseline gap-1">
                    <span className="text-4xl font-semibold tracking-tight">€{price}</span>
                    <span className="text-sm text-muted-foreground">{price === 0 ? 'назавжди' : '/ місяць'}</span>
                  </div>

                  {override && (
                    <ul className="mt-6 flex-1 space-y-3">
                      {override.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-sm">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                          <span className="text-muted-foreground">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Plain Link + buttonVariants(), not Button asChild — see hero.tsx's comment for why. */}
                  <Link
                    href={plan.key === 'enterprise' ? '#contact' : '/register'}
                    className={buttonVariants({ variant: highlighted ? 'default' : 'outline', className: 'mt-8 w-full' })}
                  >
                    {override?.ctaLabel ?? 'Почати безкоштовно'}
                  </Link>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
