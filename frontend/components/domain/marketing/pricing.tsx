import Link from 'next/link';
import { Check } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Reveal } from '@/components/domain/marketing/reveal';
import { cn } from '@/lib/utils';

/**
 * Mirrors prisma/seed.ts's real seeded Plan rows exactly (key/name/monthlyPriceEur/limits)
 * — not invented marketing numbers. If the seed's tiers/prices/limits ever
 * change, update here too so the Landing Page never promises something
 * signup doesn't actually deliver.
 */
const TIERS = [
  {
    key: 'starter',
    name: 'Starter',
    price: '0',
    period: 'назавжди',
    description: 'Щоб спробувати SH ERP у справі — без ризику й без картки.',
    features: ['До 3 користувачів', 'До 500 товарів', 'Усі основні модулі', 'Email-підтримка'],
    cta: 'Почати безкоштовно',
    href: '/register',
    highlighted: false,
  },
  {
    key: 'growth',
    name: 'Growth',
    price: '49',
    period: '/ місяць',
    description: 'Для компаній, що активно ростуть і масштабують виробництво.',
    features: [
      'До 15 користувачів',
      'До 5 000 товарів',
      'AI-асистент та розпізнавання рахунків',
      'Пріоритетна підтримка',
    ],
    cta: 'Почати безкоштовно',
    href: '/register',
    highlighted: true,
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    price: '199',
    period: '/ місяць',
    description: 'Необмежене масштабування та виділена підтримка для великого бізнесу.',
    features: [
      'Необмежена кількість користувачів',
      'Необмежена кількість товарів',
      'Виділений менеджер підтримки',
      'Індивідуальні SLA',
    ],
    cta: 'Замовити демо',
    href: '#contact',
    highlighted: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="py-20 sm:py-28">
      <div className="container">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Прозорі тарифи, без прихованих умов</h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Почніть безкоштовно на плані Starter і переходьте на вищий тариф лише тоді, коли бізнес дійсно виросте.
          </p>
        </Reveal>

        <div className="mx-auto mt-16 grid max-w-5xl grid-cols-1 gap-6 lg:grid-cols-3">
          {TIERS.map((tier, i) => (
            <Reveal key={tier.key} delayMs={i * 80}>
              <div
                className={cn(
                  'flex h-full flex-col rounded-2xl border p-8',
                  tier.highlighted ? 'border-primary bg-card shadow-xl shadow-primary/10' : 'border-border bg-card',
                )}
              >
                {tier.highlighted && (
                  <span className="mb-4 w-fit rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                    Популярний вибір
                  </span>
                )}
                <h3 className="text-lg font-semibold">{tier.name}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{tier.description}</p>
                <div className="mt-6 flex items-baseline gap-1">
                  <span className="text-4xl font-semibold tracking-tight">€{tier.price}</span>
                  <span className="text-sm text-muted-foreground">{tier.period}</span>
                </div>

                <ul className="mt-6 flex-1 space-y-3">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      <span className="text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>

                {/* Plain Link + buttonVariants(), not Button asChild — see hero.tsx's comment for why. */}
                <Link
                  href={tier.href}
                  className={buttonVariants({
                    variant: tier.highlighted ? 'default' : 'outline',
                    className: 'mt-8 w-full',
                  })}
                >
                  {tier.cta}
                </Link>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
