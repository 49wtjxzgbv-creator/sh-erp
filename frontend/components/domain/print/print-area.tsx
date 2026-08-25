'use client';

import { type ReactNode, Suspense, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { Printer, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Avatar, PrintAreaContext } from '@/components/ui/avatar';
import { PdfBranding } from './pdf-branding';

/** DOM id of the empty container AppShellOrPrintPreview.tsx renders for `?print=1` — see PrintAreaInner's portal comment below for why. */
export const PRINT_PREVIEW_ROOT_ID = 'print-preview-root';

/**
 * Shared print scaffolding for every document/label print view (production-
 * readiness pass — see globals.css's `@media print` block for the visibility
 * trick this relies on). Legacy opened a new browser tab and wrote a
 * standalone HTML document into it (`printHtmlInNewWindow_`,
 * JavaScript.html); this renders the printable markup inline in the normal
 * page instead and hides everything else via CSS at print time — same end
 * result (the browser's native print dialog, "Save as PDF" available same
 * as any print), no popup-blocker risk, no re-implementing routing/data
 * fetching inside a `document.write()`'d window.
 *
 * Usage: wrap the print-only markup in `<PrintArea>`, put a
 * `<PrintButton onClick={() => window.print()} />` (or any trigger that
 * ends in a `window.print()` call) somewhere in the normal (non-print) UI.
 *
 * `?print=1` (opened via PreviewButton below, paired with
 * AppShellOrPrintPreview stripping the app chrome for that same query
 * param) makes this render like `@media print` would — visible on screen,
 * not just hidden-until-actually-printing — so a new tab is a real preview
 * of the exact printable markup, not a guess at what printing will show.
 */
function usePrintPreviewMode(): boolean {
  const searchParams = useSearchParams();
  return searchParams.get('print') === '1';
}

function PrintAreaInner({ children, printAreaId }: { children: ReactNode; printAreaId: string }) {
  const isPreview = usePrintPreviewMode();
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);

  // Real gap found and fixed here (2026-08-24): `?print=1` opens the SAME
  // route, so this div used to render right in place, in the middle of the
  // full normal page's DOM — hiding the rest of that page via a CSS
  // visibility trick (and escaping this div from it via `position:
  // absolute`) turned out to be unreliable across browsers for scrolling
  // (side columns cut off on mobile, bottom rows cut off on desktop —
  // absolutely-positioned content's contribution to a scroll container's
  // scrollable overflow is spec-defined but inconsistent in practice). A
  // portal sidesteps the whole problem: in preview mode this renders into
  // `#print-preview-root` (AppShellOrPrintPreview.tsx), a plain empty div
  // that sits OUTSIDE the (now `display:none`-wrapped) normal page — so
  // this becomes a completely ordinary, normally-flowed, normally-
  // scrollable block, no CSS trickery required at all.
  useEffect(() => {
    if (!isPreview) {
      setPortalTarget(null);
      return;
    }
    setPortalTarget(document.getElementById(PRINT_PREVIEW_ROOT_ID));
  }, [isPreview]);

  const content = (
    <div data-print-area-id={printAreaId} className={`print-area print-area--active print:block ${isPreview ? 'block' : 'hidden'}`}>
      <PrintAreaContext.Provider value={true}>
        <PdfBranding>{children}</PdfBranding>
      </PrintAreaContext.Provider>
    </div>
  );

  if (isPreview) {
    return portalTarget ? createPortal(content, portalTarget) : null;
  }
  return content;
}

/**
 * `printAreaId` (real regression, 2026-08-25): a page can host more than one
 * `<PrintArea>` at once (e.g. production/[id]/page.tsx's assembly-spec AND
 * pick-list prints) — `@media print`'s visibility trick used to target every
 * `.print-area` unconditionally, so printing ONE made BOTH visible and
 * `position: absolute`, stacking two full documents exactly on top of each
 * other. Every print area now starts marked `print-area--active` (so a
 * single-print-view page, and a bare Ctrl+P with no button ever clicked,
 * both work exactly as before); `usePrintOptions` (print-options.tsx) only
 * deactivates every OTHER print area right before firing `window.print()`
 * itself, when a specific view's own "Друкувати" was actually clicked.
 * Optional — a caller with no `usePrintOptions` (PrintButton-only views:
 * dashboard/catalog/planner pages, product-labels-dialog.tsx) falls back to
 * its own stable per-instance id, which is never deactivated by anything
 * since it's the only print area on its page.
 */
export function PrintArea({ children, printAreaId }: { children: ReactNode; printAreaId?: string }) {
  const fallbackId = useId();
  const resolvedId = printAreaId ?? fallbackId;
  return (
    <Suspense
      fallback={
        <div data-print-area-id={resolvedId} className="print-area print-area--active hidden print:block">
          <PrintAreaContext.Provider value={true}>
            <PdfBranding>{children}</PdfBranding>
          </PrintAreaContext.Provider>
        </div>
      }
    >
      <PrintAreaInner printAreaId={resolvedId}>{children}</PrintAreaInner>
    </Suspense>
  );
}

export function PrintButton({ label, className }: { label: string; className?: string }) {
  return (
    <Button type="button" variant="outline" size="sm" className={className} onClick={() => window.print()}>
      <Printer className="mr-2 h-4 w-4" />
      {label}
    </Button>
  );
}

/** Opens THIS same page with `?print=1` in a new tab — see PrintArea's own comment for why this reuses the current route instead of a separate print-preview route. */
export function PreviewButton({ className }: { className?: string }) {
  const tp = useTranslations('print');
  function openPreview() {
    const url = new URL(window.location.href);
    url.searchParams.set('print', '1');
    window.open(url.toString(), '_blank', 'noopener');
  }
  return (
    <Button type="button" variant="outline" size="sm" className={className} onClick={openPreview}>
      <ExternalLink className="mr-2 h-4 w-4" />
      {tp('previewAction')}
    </Button>
  );
}

/** Shared header block every printed document uses — company name placeholder, document title, generation timestamp. Legacy's equivalent pulled a per-company logo from Settings; that's deferred here (see frontend/README's "Known gap: pre-login branding images" — the authenticated-shell logo isn't wired in yet either), so this prints a plain text title only, disclosed rather than faking a logo. `photoUrl` is unrelated to that gap — it's the printed document's own subject photo (e.g. the assembly being specified), not a company logo. */
export function PrintDocumentHeader({ title, subtitle, photoUrl }: { title: string; subtitle?: string; photoUrl?: string }) {
  return (
    <div className="mb-4 flex items-start gap-4 border-b border-black pb-2">
      {photoUrl && <Avatar src={photoUrl} size="xl" zoomable={false} className="rounded-none" />}
      <div>
        <h1 className="text-lg font-bold">{title}</h1>
        {subtitle && <p className="text-sm">{subtitle}</p>}
        <p className="text-xs text-gray-600">{new Date().toLocaleString()}</p>
      </div>
    </div>
  );
}
