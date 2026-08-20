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
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sh-erp.com';

export async function generateMetadata(): Promise<Metadata> {
  const locale = resolveLocale();
  const { content } = await getPublishedLandingPage();
  const seo = content.seo;
  const title = seo.title[locale] || seo.title.uk;
  const description = seo.description[locale] || seo.description.uk;
  const ogImageUrl = landingMediaUrl(seo.ogImageId);
  return {
    title,
    description,
    // Explicit self-canonical: "/" is the one real, indexable URL for this
    // content (locale is a cookie, not a path segment — see resolveLocale's
    // own comment — so there's no distinct localized URL to point away
    // from). Guards against ?query-param variants or any future proxy
    // rewrite being crawled as a separate duplicate URL.
    alternates: { canonical: SITE_URL },
    openGraph: {
      type: 'website',
      url: SITE_URL,
      siteName: 'SH ERP',
      title,
      description,
      images: ogImageUrl ? [{ url: ogImageUrl }] : [],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ogImageUrl ? [ogImageUrl] : undefined,
    },
  };
}

/**
 * JSON-LD, built only from data already fetched for the real page render —
 * no invented reviews/ratings/customer counts/features. `Offer` entries are
 * included only when `pricing.visible` is true and only from the real
 * `Plan` rows the pricing section itself renders (same source, same
 * numbers) — never duplicated/invented here.
 */
function buildJsonLd(
  c: ReturnType<typeof flattenLandingPageContent>,
  plans: Awaited<ReturnType<typeof getPublishedLandingPage>>['plans'],
) {
  const logoUrl = `${SITE_URL}/brand/logo-1024.png`;

  const organization = {
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: 'SH ERP',
    url: SITE_URL,
    logo: logoUrl,
  };

  const website = {
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    url: SITE_URL,
    name: 'SH ERP',
    publisher: { '@id': `${SITE_URL}/#organization` },
  };

  const softwareApplication = {
    '@type': 'SoftwareApplication',
    '@id': `${SITE_URL}/#software`,
    name: 'SH ERP',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: SITE_URL,
    description: c.seo.description,
    publisher: { '@id': `${SITE_URL}/#organization` },
    ...(c.pricing.visible && plans.length > 0
      ? {
          offers: plans.map((p) => ({
            '@type': 'Offer',
            name: p.name,
            price: p.monthlyPriceEur,
            priceCurrency: 'EUR',
            url: SITE_URL,
          })),
        }
      : {}),
  };

  const faqPage =
    c.faq.items.length > 0
      ? {
          '@type': 'FAQPage',
          '@id': `${SITE_URL}/#faq`,
          mainEntity: c.faq.items.map((item) => ({
            '@type': 'Question',
            name: item.question,
            acceptedAnswer: { '@type': 'Answer', text: item.answer },
          })),
        }
      : null;

  return {
    '@context': 'https://schema.org',
    '@graph': [organization, website, softwareApplication, faqPage].filter(Boolean),
  };
}

export default async function LandingPage() {
  const locale = resolveLocale();
  const { content, plans } = await getPublishedLandingPage();
  const c = flattenLandingPageContent(content, locale);
  const jsonLd = buildJsonLd(c, plans);

  return (
    <div className="flex min-h-screen flex-col">
      {/* `<` escaped so Super-Admin-edited copy (e.g. an FAQ answer) can never contain a literal "</script>" and break out of this tag. */}
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
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
  );
}
