import { Reveal } from '@/components/domain/marketing/reveal';
import { ShowcaseStep } from '@/components/domain/marketing/showcase-step';
import { landingMediaUrl } from '@/lib/landing-page/media-url';
import type { FlatLandingPageContent } from '@/lib/landing-page/flatten-content';

/**
 * The "product storytelling" section — the real order lifecycle (order →
 * shortage/reservation → procurement → supplier portal → receiving →
 * auto-reservation → production → shipment), each step backed by a real
 * screenshot of actual SH ERP UI (Phase 3, a disclosed follow-up — the
 * fixed 8 step ids/order are seeded in INITIAL_LANDING_PAGE_CONTENT and
 * editable via the Landing Page Editor's showcase section, not this
 * component). Editorial alternating-side timeline layout, not a card grid —
 * this is the section meant to carry the "real product, not a template"
 * weight of the whole redesign.
 */
export function ShowcaseScenario({ showcase }: { showcase: FlatLandingPageContent['showcase'] }) {
  return (
    <section id="how-it-works" className="border-y border-border bg-secondary/20 py-24 sm:py-32">
      <div className="container">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl lg:text-[2.75rem]">{showcase.heading}</h2>
          <p className="mt-5 text-balance text-lg leading-relaxed text-muted-foreground">{showcase.subheading}</p>
        </Reveal>

        <div className="mx-auto mt-24 flex max-w-5xl flex-col gap-24">
          {showcase.steps.map((step, i) => (
            <ShowcaseStep
              key={step.id}
              index={i + 1}
              title={step.title}
              description={step.description}
              imageUrl={landingMediaUrl(step.imageId)}
              reverse={i % 2 === 1}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
