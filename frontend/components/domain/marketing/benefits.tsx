import { ShieldCheck, Zap, Building2, Globe } from 'lucide-react';
import { Reveal } from '@/components/domain/marketing/reveal';

const BENEFITS = [
  {
    icon: ShieldCheck,
    title: 'Безпека на рівні бази даних',
    description:
      'Ізоляція даних кожної компанії забезпечується не лише в коді, а й на рівні PostgreSQL (Row-Level Security) — подвійний захист від витоку між клієнтами.',
  },
  {
    icon: Building2,
    title: 'Готовність до масштабування',
    description:
      'Архітектура розрахована на тисячі компаній і мільйони записів з першого дня — не MVP, який доведеться переписувати після росту.',
  },
  {
    icon: Zap,
    title: 'Швидкість, а не колеса завантаження',
    description:
      'Сучасний стек (Next.js, NestJS, PostgreSQL) і наскрізна типізація API означають менше багів і миттєвий відгук інтерфейсу.',
  },
  {
    icon: Globe,
    title: 'Гнучкі ролі та мультимовність',
    description:
      'Повністю кастомізовані ролі та права доступу для кожної компанії, інтерфейс українською, англійською, польською та німецькою.',
  },
];

export function Benefits() {
  return (
    <section className="border-y border-border bg-secondary/30 py-20 sm:py-28">
      <div className="container">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Побудовано для компаній, які виросли з таблиць
            </h2>
            <p className="mt-4 max-w-lg text-lg text-muted-foreground">
              SH ERP замінює розрізнені Excel-файли та застарілі системи одним продуктом, який росте разом із вашим
              бізнесом — від першого замовлення до сотень співробітників.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {BENEFITS.map((benefit, i) => (
              <Reveal key={benefit.title} delayMs={i * 80}>
                <div className="flex gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <benefit.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{benefit.title}</h3>
                    <p className="mt-1.5 text-sm text-muted-foreground">{benefit.description}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
