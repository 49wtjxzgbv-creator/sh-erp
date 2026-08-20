'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MarketingHeader } from '@/components/domain/marketing/marketing-header';
import { Hero } from '@/components/domain/marketing/hero';
import { ModulesGrid } from '@/components/domain/marketing/modules-grid';
import { ShowcaseScenario } from '@/components/domain/marketing/showcase-scenario';
import { Benefits } from '@/components/domain/marketing/benefits';
import { Pricing } from '@/components/domain/marketing/pricing';
import { Faq } from '@/components/domain/marketing/faq';
import { ContactSection } from '@/components/domain/marketing/contact-section';
import { MarketingFooter } from '@/components/domain/marketing/marketing-footer';
import { LocaleSwitcher } from '@/components/domain/super-admin/landing-editor/locale-switcher';
import { flattenLandingPageContent } from '@/lib/landing-page/flatten-content';
import { landingPageAdminApi } from '@/lib/super-admin/landing-page-api';
import type { Locale } from '@/lib/i18n-locales';
import type { LandingPageContent } from '@/lib/landing-page/types';

/**
 * Renders the SAME public marketing components (components/domain/marketing/*)
 * as the real "/" page, fed with the DRAFT content instead of the published
 * one — not a signed-cookie trick on the real public URL. Authenticated
 * (this whole route tree sits inside SuperAdminLayout's session gate), so
 * this is safe to show unpublished/WIP copy on. Media images resolve
 * through the same public streaming proxy the real page uses
 * (landing-page/media/:id, see lib/landing-page/media-url.ts) since that
 * proxy needs no auth — the draft's images are already real uploaded
 * assets, not presigned-URL-only until publish.
 */
export default function LandingPagePreview() {
  const [locale, setLocale] = useState<Locale>('uk');
  const [content, setContent] = useState<LandingPageContent | null>(null);
  const [plans, setPlans] = useState<Array<{ id: string; key: string; name: string; monthlyPriceEur: string; limits: unknown }>>([]);

  useEffect(() => {
    landingPageAdminApi.getDraft().then((row) => setContent(row.content));
    fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/landing-page`)
      .then((res) => res.json())
      .then((data) => setPlans(data.plans ?? []));
  }, []);

  if (!content) return <p className="text-slate-400">Завантаження попереднього перегляду…</p>;

  const c = flattenLandingPageContent(content, locale);

  return (
    <div className="rounded-md border border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 p-3">
        <div className="flex items-center gap-3">
          <Link href="/super-admin/landing" className="text-xs text-slate-400 hover:text-slate-200">
            ← Назад до редактора
          </Link>
          <p className="text-xs text-slate-400">Попередній перегляд чернетки — публічна сторінка ще НЕ оновлена.</p>
        </div>
        <LocaleSwitcher locale={locale} onChange={setLocale} />
      </div>
      <div className="bg-background text-foreground">
        <div className="flex min-h-screen flex-col">
          <MarketingHeader pricingVisible={c.pricing.visible} />
          <main className="flex-1">
            <Hero content={c.hero} />
            <ModulesGrid modules={c.modules} />
            <ShowcaseScenario showcase={c.showcase} />
            <Benefits content={c.benefits} />
            {c.pricing.visible && <Pricing content={c.pricing} plans={plans} />}
            <Faq faq={c.faq} />
            <ContactSection content={c.contact} />
          </main>
          <MarketingFooter tagline={c.footer.tagline} pricingVisible={c.pricing.visible} />
        </div>
      </div>
    </div>
  );
}
