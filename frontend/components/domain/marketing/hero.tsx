import Link from 'next/link';
import { ArrowRight, PlayCircle } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Reveal } from '@/components/domain/marketing/reveal';
import { ProductPreview } from '@/components/domain/marketing/product-preview';

export function Hero() {
  return (
    <section id="product" className="relative overflow-hidden pb-20 pt-16 sm:pb-28 sm:pt-24">
      {/* Soft radial glow behind the headline — Stripe/Linear-style ambient background, pure CSS, no image asset. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px] dark:bg-primary/25"
      />

      <div className="container">
        <Reveal className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm">
            <span className="flex h-1.5 w-1.5 rounded-full bg-success" />
            Мультитенантна ERP нового покоління
          </div>

          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl">
            Виробництво, склад і продажі —{' '}
            <span className="bg-gradient-to-r from-primary to-fuchsia-400 bg-clip-text text-transparent">
              в одній системі
            </span>
          </h1>

          <p className="mt-6 max-w-2xl text-balance text-lg text-muted-foreground sm:text-xl">
            SH ERP об&rsquo;єднує виробництво, склад, закупівлі, продажі, BOM, HR і AI&#8209;асистента в один
            швидкий продукт — без хаосу з таблицями та розрізненими системами.
          </p>

          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
            {/*
              Deliberately a plain <Link className={buttonVariants(...)}>, NOT
              <Button asChild><Link>...</Link></Button> — that combination
              (Radix Slot cloning a next/link Client Component from inside a
              Server Component page) throws "Slot failed to slot onto its
              children" during `next build`'s static-generation pass. Real,
              reproduced bug (isolated to a 3-line repro), not a style
              preference — every other Button+asChild+Link pair in this app
              lives inside a 'use client' page, which is why this never
              surfaced before the Landing Page (this app's first Server
              Component page using that pattern).
            */}
            <Link href="/register" className={buttonVariants({ size: 'lg', className: 'w-full sm:w-auto' })}>
              Почати безкоштовно
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            <a
              href="#contact"
              className={buttonVariants({ size: 'lg', variant: 'outline', className: 'w-full sm:w-auto' })}
            >
              <PlayCircle className="mr-2 h-4 w-4" />
              Замовити демо
            </a>
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            Безкоштовний план Starter назавжди · Кредитна картка не потрібна
          </p>
        </Reveal>

        <Reveal delayMs={150} className="mt-16 sm:mt-20">
          <ProductPreview />
        </Reveal>
      </div>
    </section>
  );
}
