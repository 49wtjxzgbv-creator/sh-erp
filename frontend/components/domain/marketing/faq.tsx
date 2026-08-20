'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Reveal } from '@/components/domain/marketing/reveal';
import { cn } from '@/lib/utils';
import type { FlatLandingPageContent } from '@/lib/landing-page/flatten-content';

export function Faq({ faq }: { faq: FlatLandingPageContent['faq'] }) {
  const [openId, setOpenId] = useState<string | null>(faq.items[0]?.id ?? null);

  return (
    <section id="faq" className="border-t border-border py-24 sm:py-32">
      <div className="container">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl lg:text-[2.75rem]">{faq.heading}</h2>
        </Reveal>

        <div className="mx-auto mt-14 max-w-2xl divide-y divide-border">
          {faq.items.map((item) => {
            const open = openId === item.id;
            return (
              <div key={item.id} className="py-5">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-4 text-left"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : item.id)}
                >
                  <span className="font-medium tracking-tight">{item.question}</span>
                  <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
                </button>
                {/* Always rendered (never conditionally mounted) so every answer is
                    present in the server-rendered HTML for crawlers/FAQPage rich
                    results — only the CSS `hidden` class toggles, same instant
                    show/hide the conditional-render version had, no new animation. */}
                <p className={cn('mt-3.5 leading-relaxed text-muted-foreground', !open && 'hidden')}>{item.answer}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
