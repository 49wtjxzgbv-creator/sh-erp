import type { ReactNode } from 'react';

/**
 * Corporate PDF branding — the SH ERP wordmark top-left plus a
 * "SH-ERP.PRO / by Shyryng" footer, on every printed document. Rendered
 * exactly once here and composed straight into `<PrintArea>` (see
 * print-area.tsx) rather than required as a per-view opt-in — every one of
 * the app's print views (customer orders, BOM specs, supplier requests,
 * pick lists, product labels, planner, dashboard timeline, availability
 * reports, and anything printed in the future) already renders its content
 * inside `<PrintArea>`, so this reaches all of them automatically with zero
 * per-view wiring and nothing to forget on a new print view. Wraps
 * `children` (header before, footer after) rather than rendering as
 * standalone siblings, because real print and the on-screen preview need
 * opposite DOM/positioning strategies (see below) and getting the order
 * right matters for the preview's normal-flow case.
 *
 * In real print (`@media print`), header/footer are `position: fixed`
 * (globals.css) — the one technique Chrome's print engine reliably repeats
 * on every physical printed page, since there is no server-side PDF
 * renderer in this app (`print-area.tsx`'s own header comment): "printing
 * to PDF" IS the browser's native print dialog over this same styled HTML.
 *
 * In the on-screen `?print=1` preview, `.print-area` is a normal in-flow
 * block (unlike real print, it isn't pinned to a single page-sized box), so
 * a `position: fixed` header/footer there would anchor to the raw browser
 * viewport instead of the document — floating on top of whatever content
 * happens to be scrolled underneath rather than sitting at the top/bottom
 * of the actual document. Preview CSS therefore renders both in normal flow
 * instead: once above the content, once below — an honest approximation
 * (there's no real pagination to repeat *across* outside of actual
 * printing), not a broken one.
 */
export function PdfBranding({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="pdf-header" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-sh-erp.svg" alt="" className="pdf-header-logo" />
      </div>
      {children}
      <div className="pdf-footer" aria-hidden="true">
        <div className="pdf-footer-line" />
        <p className="pdf-footer-brand">SH-ERP.PRO</p>
        <p className="pdf-footer-tagline">by Shyryng</p>
      </div>
    </>
  );
}
