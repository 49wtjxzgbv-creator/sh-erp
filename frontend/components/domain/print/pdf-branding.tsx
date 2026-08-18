/**
 * Corporate PDF branding — the SH ERP wordmark top-left plus a
 * "SH-ERP.PRO / by Shyryng" footer, on every printed document. Rendered
 * exactly once here and composed straight into `<PrintArea>` (see
 * print-area.tsx) rather than required as a per-view opt-in — every one of
 * the app's print views (customer orders, BOM specs, supplier requests,
 * pick lists, product labels, planner, dashboard timeline, availability
 * reports, and anything printed in the future) already renders its content
 * inside `<PrintArea>`, so this reaches all of them automatically with zero
 * per-view wiring and nothing to forget on a new print view.
 *
 * Positioned via `position: fixed` (globals.css's `.pdf-header`/`.pdf-footer`
 * rules) — the one technique Chrome's print engine reliably repeats on
 * every physical printed page, since there is no server-side PDF renderer
 * in this app (`print-area.tsx`'s own header comment): "printing to PDF" IS
 * the browser's native print dialog over this same styled HTML, so a fixed
 * element behaves identically whether the user is looking at the on-screen
 * preview or the browser's own print-to-PDF output.
 */
export function PdfBranding() {
  return (
    <>
      <div className="pdf-header" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-sh-erp.svg" alt="" className="pdf-header-logo" />
      </div>
      <div className="pdf-footer" aria-hidden="true">
        <div className="pdf-footer-line" />
        <p className="pdf-footer-brand">SH-ERP.PRO</p>
        <p className="pdf-footer-tagline">by Shyryng</p>
      </div>
    </>
  );
}
