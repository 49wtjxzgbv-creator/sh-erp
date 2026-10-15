import { ListTree, Factory, Wallet, ArrowRight, ArrowDown } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * "лендинг якось по бідному виглядає" (2026-10-15) — the hero had NO visual
 * at all (HeroScreenshot only renders once `heroImageId` is set, and it
 * never has been: the only real screenshots on hand are from a mostly-empty
 * "landing-demo" sandbox company — every amount reads 0.00 €, every date
 * reads "не заплановано" — using one as the FIRST thing a visitor sees
 * would read as emptier, not richer, than no image at all; see
 * showcase-step.tsx's own placeholder for the "honest, not fabricated"
 * house rule this follows too). This diagram illustrates the headline's own
 * claim literally (BOM → production → payroll) rather than pretending to be
 * product UI — same dot-grid + icon-tile language as hero's own background
 * glow and the showcase placeholders, so it reads as one consistent visual
 * system rather than a bolted-on illustration.
 */
export function HeroFlowDiagram() {
  const t = useTranslations('marketing');

  const steps = [
    { icon: ListTree, label: t('heroFlowBom') },
    { icon: Factory, label: t('heroFlowProduction') },
    { icon: Wallet, label: t('heroFlowPayroll') },
  ];

  return (
    <div className="relative mx-auto max-w-3xl overflow-hidden rounded-2xl border border-border bg-card p-10 shadow-2xl shadow-primary/10 sm:p-14">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 [background-image:radial-gradient(hsl(var(--foreground)/0.06)_1px,transparent_1px)] [background-size:24px_24px]"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-primary/[0.08] blur-3xl"
      />

      <div className="relative flex flex-col items-center justify-center gap-5 sm:flex-row sm:gap-6">
        {steps.map((step, i) => (
          <div key={step.label} className="flex flex-col items-center gap-5 sm:flex-row sm:gap-6">
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary sm:h-20 sm:w-20">
                <step.icon className="h-7 w-7 sm:h-9 sm:w-9" />
              </div>
              <span className="text-sm font-medium text-foreground">{step.label}</span>
            </div>
            {i < steps.length - 1 && (
              <>
                <ArrowDown className="h-5 w-5 shrink-0 text-muted-foreground/40 sm:hidden" />
                <ArrowRight className="hidden h-5 w-5 shrink-0 text-muted-foreground/40 sm:block" />
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
