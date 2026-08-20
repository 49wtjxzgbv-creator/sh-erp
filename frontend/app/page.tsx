import type { Metadata } from 'next';
import { MarketingHeader } from '@/components/domain/marketing/marketing-header';
import { Hero } from '@/components/domain/marketing/hero';
import { ModulesGrid } from '@/components/domain/marketing/modules-grid';
import { ShowcaseScenario } from '@/components/domain/marketing/showcase-scenario';
import { Benefits } from '@/components/domain/marketing/benefits';
import { Pricing } from '@/components/domain/marketing/pricing';
import { Faq } from '@/components/domain/marketing/faq';
import { ContactSection } from '@/components/domain/marketing/contact-section';
import { MarketingFooter } from '@/components/domain/marketing/marketing-footer';
import { getPublishedLandingPage } from '@/lib/landing-page/get-published-content';
import { flattenLandingPageContent } from '@/lib/landing-page/flatten-content';
import { resolveLocale } from '@/lib/landing-page/resolve-locale';
import { landingMediaUrl } from '@/lib/landing-page/media-url';

/**
 * Public Landing Page (2026-08-05, content-driven since 2026-08-20) — this
 * used to be a redirect straight to /dashboard (which middleware.ts then
 * bounced to /login for anyone signed out, meaning every first-time
 * visitor's actual first screen was a bare login form). Now "/" is real
 * marketing content; /login and /register are their own routes under
 * app/(public)/. An already signed-in visitor landing here is redirected to
 * /dashboard by middleware.ts instead of seeing this page again.
 *
 * Content (hero/modules/showcase/benefits/pricing/faq/contact/footer/seo)
 * comes from GET /landing-page (backend/src/modules/landing-page) — the
 * PUBLISHED LandingPageVersion, Super-Admin-editable without a code deploy
 * (frontend/app/super-admin/landing/). Header nav and CTA labels stay
 * static UI chrome, translated through next-intl like the rest of the app —
 * not versioned content (see the implementation plan's own scoping note).
 *
 * Composed from small, independent section components
 * (components/domain/marketing/*) rather than one large page file, per the
 * same module-per-file convention the rest of this app already follows.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = resolveLocale();
  const { content, mediaUrls } = await getPublishedLandingPage();
  const seo = content.seo;
  const ogImageUrl = landingMediaUrl(mediaUrls, seo.ogImageId);
  return {
    title: seo.title[locale] || seo.title.uk,
    description: seo.description[locale] || seo.description.uk,
    openGraph: {
      title: seo.title[locale] || seo.title.uk,
      description: seo.description[locale] || seo.description.uk,
      images: ogImageUrl ? [{ url: ogImageUrl }] : [],
    },
  };
}

export default async function LandingPage() {
  const locale = resolveLocale();
  const { content, plans, mediaUrls } = await getPublishedLandingPage();
  const c = flattenLandingPageContent(content, locale);

  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />
      <main className="flex-1">
        <Hero content={c.hero} mediaUrls={mediaUrls} />
        <ModulesGrid modules={c.modules} />
        <ShowcaseScenario showcase={c.showcase} mediaUrls={mediaUrls} />
        <Benefits content={c.benefits} />
        {c.pricing.visible && <Pricing content={c.pricing} plans={plans} />}
        <Faq faq={c.faq} />
        <ContactSection content={c.contact} />
      </main>
      <MarketingFooter tagline={c.footer.tagline} />
    </div>
  );
}
