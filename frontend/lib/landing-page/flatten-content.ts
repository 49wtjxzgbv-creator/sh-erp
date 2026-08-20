import type { Locale } from '@/lib/i18n-locales';
import type { LandingPageContent, LocalizedText } from './types';

function t(text: LocalizedText, locale: Locale): string {
  return text[locale] || text.uk;
}

export interface FlatLandingPageContent {
  hero: {
    eyebrow: string;
    headline: string;
    subheadline: string;
    primaryCta: { label: string; href: string };
    secondaryCta: { label: string; href: string };
    microcopy: string;
    heroImageId: string | null;
  };
  modules: {
    heading: string;
    subheading: string;
    items: Array<{ id: string; icon: string; title: string; description: string; sortOrder: number; visible: boolean }>;
  };
  showcase: {
    heading: string;
    subheading: string;
    steps: Array<{ id: string; title: string; description: string; imageId: string | null; sortOrder: number }>;
  };
  benefits: {
    heading: string;
    subheading: string;
    items: Array<{ id: string; icon: string; title: string; description: string; sortOrder: number; visible: boolean }>;
  };
  pricing: {
    heading: string;
    subheading: string;
    highlightedPlanKey: string | null;
    tierCopyOverrides: Array<{ planKey: string; description: string; ctaLabel: string; features: string[] }>;
  };
  faq: { heading: string; items: Array<{ id: string; question: string; answer: string; sortOrder: number; visible: boolean }> };
  contact: { heading: string; subheading: string; salesEmail: string; responseTimeNote: string; formSubmitLabel: string; mailtoSubject: string };
  footer: { tagline: string };
  seo: { title: string; description: string; ogImageId: string | null };
}

/** Picks each field's locale once, server-side, so section components take plain-string props instead of re-resolving locale everywhere. */
export function flattenLandingPageContent(content: LandingPageContent, locale: Locale): FlatLandingPageContent {
  return {
    hero: {
      eyebrow: t(content.hero.eyebrow, locale),
      headline: t(content.hero.headline, locale),
      subheadline: t(content.hero.subheadline, locale),
      primaryCta: { label: t(content.hero.primaryCta.label, locale), href: content.hero.primaryCta.href },
      secondaryCta: { label: t(content.hero.secondaryCta.label, locale), href: content.hero.secondaryCta.href },
      microcopy: t(content.hero.microcopy, locale),
      heroImageId: content.hero.heroImageId,
    },
    modules: {
      heading: t(content.modules.heading, locale),
      subheading: t(content.modules.subheading, locale),
      items: content.modules.items
        .filter((m) => m.visible)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((m) => ({ id: m.id, icon: m.icon, title: t(m.title, locale), description: t(m.description, locale), sortOrder: m.sortOrder, visible: m.visible })),
    },
    showcase: {
      heading: t(content.showcase.heading, locale),
      subheading: t(content.showcase.subheading, locale),
      steps: [...content.showcase.steps]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((s) => ({ id: s.id, title: t(s.title, locale), description: t(s.description, locale), imageId: s.imageId, sortOrder: s.sortOrder })),
    },
    benefits: {
      heading: t(content.benefits.heading, locale),
      subheading: t(content.benefits.subheading, locale),
      items: content.benefits.items
        .filter((b) => b.visible)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((b) => ({ id: b.id, icon: b.icon, title: t(b.title, locale), description: t(b.description, locale), sortOrder: b.sortOrder, visible: b.visible })),
    },
    pricing: {
      heading: t(content.pricing.heading, locale),
      subheading: t(content.pricing.subheading, locale),
      highlightedPlanKey: content.pricing.highlightedPlanKey,
      tierCopyOverrides: content.pricing.tierCopyOverrides.map((o) => ({
        planKey: o.planKey,
        description: t(o.description, locale),
        ctaLabel: t(o.ctaLabel, locale),
        features: o.features.map((f) => t(f, locale)),
      })),
    },
    faq: {
      heading: t(content.faq.heading, locale),
      items: content.faq.items
        .filter((f) => f.visible)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((f) => ({ id: f.id, question: t(f.question, locale), answer: t(f.answer, locale), sortOrder: f.sortOrder, visible: f.visible })),
    },
    contact: {
      heading: t(content.contact.heading, locale),
      subheading: t(content.contact.subheading, locale),
      salesEmail: content.contact.salesEmail,
      responseTimeNote: t(content.contact.responseTimeNote, locale),
      formSubmitLabel: t(content.contact.formSubmitLabel, locale),
      mailtoSubject: t(content.contact.mailtoSubject, locale),
    },
    footer: { tagline: t(content.footer.tagline, locale) },
    seo: { title: t(content.seo.title, locale), description: t(content.seo.description, locale), ogImageId: content.seo.ogImageId },
  };
}
