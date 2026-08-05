import { MarketingHeader } from '@/components/domain/marketing/marketing-header';
import { Hero } from '@/components/domain/marketing/hero';
import { ModulesGrid } from '@/components/domain/marketing/modules-grid';
import { Benefits } from '@/components/domain/marketing/benefits';
import { Pricing } from '@/components/domain/marketing/pricing';
import { Faq } from '@/components/domain/marketing/faq';
import { ContactSection } from '@/components/domain/marketing/contact-section';
import { MarketingFooter } from '@/components/domain/marketing/marketing-footer';

/**
 * Public Landing Page (2026-08-05) — this used to be a redirect straight to
 * /dashboard (which middleware.ts then bounced to /login for anyone
 * signed out, meaning every first-time visitor's actual first screen was a
 * bare login form). Now "/" is real marketing content; /login and
 * /register are their own routes under app/(public)/. An already
 * signed-in visitor landing here is redirected to /dashboard by
 * middleware.ts instead of seeing this page again.
 *
 * Composed from small, independent section components
 * (components/domain/marketing/*) rather than one large page file, per the
 * same module-per-file convention the rest of this app already follows.
 */
export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />
      <main className="flex-1">
        <Hero />
        <ModulesGrid />
        <Benefits />
        <Pricing />
        <Faq />
        <ContactSection />
      </main>
      <MarketingFooter />
    </div>
  );
}
