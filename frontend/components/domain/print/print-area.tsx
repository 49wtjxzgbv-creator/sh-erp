'use client';

import { type ReactNode, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Printer, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { PdfBranding } from './pdf-branding';

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

function PrintAreaInner({ children }: { children: ReactNode }) {
  const isPreview = usePrintPreviewMode();
  return (
    <div className={`print-area print:block ${isPreview ? 'block' : 'hidden'}`}>
      <PdfBranding>{children}</PdfBranding>
    </div>
  );
}

export function PrintArea({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="print-area hidden print:block">
          <PdfBranding>{children}</PdfBranding>
        </div>
      }
    >
      <PrintAreaInner>{children}</PrintAreaInner>
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
