import type { ReactNode } from 'react';

/**
 * Corporate PDF branding — the SH ERP wordmark once at the very top of the
 * document (page 1 only) and a "SH-ERP.PRO / by Shyryng" footer once at the
 * very end (the last page only, wherever that naturally falls). Rendered
 * exactly once here and composed straight into `<PrintArea>` (see
 * print-area.tsx) rather than required as a per-view opt-in — every one of
 * the app's print views (customer orders, BOM specs, supplier requests,
 * pick lists, product labels, planner, dashboard timeline, availability
 * reports, and anything printed in the future) already renders its content
 * inside `<PrintArea>`, so this reaches all of them automatically with zero
 * per-view wiring and nothing to forget on a new print view.
 *
 * Deliberately plain, normal-flow siblings — header before `children`,
 * footer after — not `position: fixed`/`sticky` and not a `<thead>`/
 * `<tfoot>` table wrapper. Two earlier attempts at "repeat on every page"
 * both caused real regressions: `position: fixed` only gets reserved
 * padding space on the first/last printed page (fragmented-box padding
 * doesn't repeat on pages in between), so it overlapped real content from
 * page 2 onward; a `<table>` wrapper with `table-header-group`/
 * `table-footer-group` fixed that, but its own `td` border/padding reset
 * (needed so the wrapper's structural cells stayed invisible) used a plain
 * descendant selector that also matched every `<td>` inside the actual
 * printed tables nested in `children`, stripping their borders/columns.
 * Once the requirement changed to "logo only on page 1, footer only on the
 * last page" (not every page), neither trick is needed at all — a normal
 * in-flow element at the very start of the content naturally prints on
 * page 1, and one at the very end naturally lands on whatever page the
 * document happens to finish on, with zero risk of leaking styles into
 * unrelated nested tables.
 */
export function PdfBranding({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="pdf-header" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo-1024.png" alt="" className="pdf-header-logo" />
        <span className="pdf-header-divider" />
        <span className="pdf-header-brand">SH-ERP.PRO</span>
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
