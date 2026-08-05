import {
  Factory,
  Warehouse,
  Truck,
  ShoppingCart,
  ListTree,
  Sparkles,
  BarChart3,
  Users,
} from 'lucide-react';
import { Reveal } from '@/components/domain/marketing/reveal';

const MODULES = [
  {
    icon: Factory,
    title: 'Виробництво',
    description:
      'Виробничі замовлення повного циклу: резервування матеріалів, стадії виконання, серійні номери готової продукції та QC-контроль.',
  },
  {
    icon: Warehouse,
    title: 'Склад',
    description:
      'Облік залишків у реальному часі, переміщення між складами, інвентаризації з розбіжностями та повна історія рухів.',
  },
  {
    icon: ListTree,
    title: 'BOM',
    description:
      'Багаторівневі специфікації з версіонуванням, автоматичний розрахунок собівартості та перевірка доступності компонентів.',
  },
  {
    icon: Truck,
    title: 'Закупівлі',
    description:
      'Постачальники, замовлення на закупівлю та приймання товару з автоматичним оновленням залишків складу.',
  },
  {
    icon: ShoppingCart,
    title: 'Продажі',
    description:
      'Замовлення клієнтів, відвантаження та автоматичний розрахунок дефіциту з пропозиціями на закупівлю.',
  },
  {
    icon: Users,
    title: 'HR та зарплата',
    description: 'Співробітники, відрядна оплата праці та звірка з результатами контролю якості.',
  },
  {
    icon: BarChart3,
    title: 'Звіти',
    description:
      'Рекомендації щодо поповнення запасів, оцінка вартості складу та щомісячні виробничі підсумки.',
  },
  {
    icon: Sparkles,
    title: 'AI-асистент',
    description:
      'Розпізнавання рахунків постачальників, голосові команди та інтелектуальні підказки — з підтвердженням критичних дій людиною.',
  },
];

export function ModulesGrid() {
  return (
    <section id="modules" className="py-20 sm:py-28">
      <div className="container">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Один продукт замість десяти таблиць</h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Кожен модуль SH ERP покриває реальний процес вашого бізнесу — від сировини на складі до відвантаженого
            замовлення клієнту.
          </p>
        </Reveal>

        <div className="mt-16 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map((module, i) => (
            <Reveal key={module.title} delayMs={i * 60}>
              <div className="group h-full rounded-xl border border-border bg-card p-6 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-accent text-accent-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <module.icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">{module.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{module.description}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
