'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Reveal } from '@/components/domain/marketing/reveal';
import { cn } from '@/lib/utils';

const FAQ_ITEMS = [
  {
    q: 'Чи можу я перенести дані з Excel або іншої системи?',
    a: 'Так. Ми маємо окремий інструментарій міграції даних (імпорт товарів, залишків, специфікацій тощо) та готові допомогти з перенесенням існуючих даних без втрат.',
  },
  {
    q: 'Наскільки безпечні дані моєї компанії?',
    a: 'Дані кожної компанії ізольовані подвійним рівнем захисту: на рівні застосунку та на рівні самої бази даних (PostgreSQL Row-Level Security). Жодна компанія не може отримати доступ до даних іншої.',
  },
  {
    q: 'Чи можна змінити план пізніше?',
    a: 'Так, ви можете підвищити або понизити тариф у будь-який момент із розділу «Тарифи» у вашому кабінеті — без втрати даних.',
  },
  {
    q: 'Чи є мобільний доступ?',
    a: 'Інтерфейс повністю адаптивний і працює в браузері на телефоні чи планшеті вже сьогодні; нативні мобільні застосунки — у наших найближчих планах.',
  },
  {
    q: 'Що входить у AI-асистента?',
    a: 'Розпізнавання рахунків постачальників, відповіді на запитання щодо замовлень та голосовий режим — усі критичні дії (наприклад, коригування залишків) завжди вимагають вашого підтвердження.',
  },
  {
    q: 'Чи потрібна кредитна картка для реєстрації?',
    a: 'Ні. План Starter безкоштовний назавжди й не вимагає жодних платіжних даних для початку роботи.',
  },
];

export function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="border-t border-border py-20 sm:py-28">
      <div className="container">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Часті запитання</h2>
        </Reveal>

        <div className="mx-auto mt-12 max-w-2xl divide-y divide-border">
          {FAQ_ITEMS.map((item, i) => {
            const open = openIndex === i;
            return (
              <div key={item.q} className="py-4">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-4 text-left"
                  aria-expanded={open}
                  onClick={() => setOpenIndex(open ? null : i)}
                >
                  <span className="font-medium">{item.q}</span>
                  <ChevronDown
                    className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
                  />
                </button>
                {open && <p className="mt-3 text-sm text-muted-foreground">{item.a}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
