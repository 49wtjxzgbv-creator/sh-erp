import Image from 'next/image';

/**
 * Replaces the old hand-built fake dashboard mockup (product-preview.tsx,
 * deleted) — a real screenshot of the actual product (Phase 3: captured via
 * a manual, labeled `[Навчання]` sandbox walkthrough, uploaded through the
 * Landing Page Editor's media library), not an illustration. Keeps the same
 * browser-chrome frame styling the old mockup used — that's generic UI
 * chrome, not a claim about the content inside it.
 */
export function HeroScreenshot({ src }: { src: string }) {
  return (
    <div className="mx-auto max-w-5xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-primary/10">
      <div className="flex items-center gap-1.5 border-b border-border bg-secondary/40 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
        <span className="ml-3 rounded-md bg-background/60 px-3 py-0.5 text-[11px] text-muted-foreground">sh-erp.pro</span>
      </div>
      <Image src={src} alt="" width={1600} height={960} className="h-auto w-full" priority />
    </div>
  );
}
