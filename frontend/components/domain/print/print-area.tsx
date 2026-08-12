'use client';

import { type ReactNode } from 'react';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';

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
 */
export function PrintArea({ children }: { children: ReactNode }) {
  return <div className="print-area hidden print:block">{children}</div>;
}

export function PrintButton({ label, className }: { label: string; className?: string }) {
  return (
    <Button type="button" variant="outline" size="sm" className={className} onClick={() => window.print()}>
      <Printer className="mr-2 h-4 w-4" />
      {label}
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
