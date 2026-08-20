/**
 * Mirrors backend/src/modules/landing-page/landing-page-content.types.ts —
 * same convention as every other file in lib/api-client/*.ts (this repo has
 * no shared frontend/backend types package, so response shapes are mirrored
 * by hand). Keep in sync if the backend shape changes.
 */

export interface LocalizedText {
  uk: string;
  en: string;
  pl: string;
  de: string;
}

export interface LandingPageContent {
  hero: {
    eyebrow: LocalizedText;
    headline: LocalizedText;
    subheadline: LocalizedText;
    primaryCta: { label: LocalizedText; href: string };
    secondaryCta: { label: LocalizedText; href: string };
    microcopy: LocalizedText;
    heroImageId: string | null;
  };
  modules: {
    heading: LocalizedText;
    subheading: LocalizedText;
    items: Array<{ id: string; icon: string; title: LocalizedText; description: LocalizedText; sortOrder: number; visible: boolean }>;
  };
  showcase: {
    heading: LocalizedText;
    subheading: LocalizedText;
    steps: Array<{ id: string; title: LocalizedText; description: LocalizedText; imageId: string | null; sortOrder: number }>;
  };
  benefits: {
    heading: LocalizedText;
    subheading: LocalizedText;
    items: Array<{ id: string; icon: string; title: LocalizedText; description: LocalizedText; sortOrder: number; visible: boolean }>;
  };
  pricing: {
    heading: LocalizedText;
    subheading: LocalizedText;
    highlightedPlanKey: string | null;
    tierCopyOverrides: Array<{ planKey: string; description: LocalizedText; ctaLabel: LocalizedText; features: LocalizedText[] }>;
  };
  faq: {
    heading: LocalizedText;
    items: Array<{ id: string; question: LocalizedText; answer: LocalizedText; sortOrder: number; visible: boolean }>;
  };
  contact: {
    heading: LocalizedText;
    subheading: LocalizedText;
    salesEmail: string;
    responseTimeNote: LocalizedText;
    formSubmitLabel: LocalizedText;
    mailtoSubject: LocalizedText;
  };
  footer: { tagline: LocalizedText };
  seo: { title: LocalizedText; description: LocalizedText; ogImageId: string | null };
}

export interface LandingPagePlan {
  id: string;
  key: string;
  name: string;
  monthlyPriceEur: string;
  limits: unknown;
}

export interface PublicLandingPageResponse {
  content: LandingPageContent;
  plans: LandingPagePlan[];
  /** mediaId -> public URL, already resolved server-side. A missing entry means "no image", not an error. */
  mediaUrls: Record<string, string>;
  versionId: string | null;
  publishedAt: string | null;
}
