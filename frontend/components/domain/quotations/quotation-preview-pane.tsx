'use client';

import { useTranslations } from 'next-intl';
import { useQuotationPreview } from '@/lib/hooks/use-quotations';
import { LoadingBlock } from '@/components/ui/loading-block';

/**
 * §8/§6 of the frontend spec: renders the exact same HTML the backend
 * feeds to Playwright for the PDF (QuotationRendererService, via
 * GET quotations/:id/preview) — never a second, hand-rolled React
 * approximation of the document that could visually drift from what a
 * client actually receives.
 *
 * `<iframe srcDoc>` rather than `dangerouslySetInnerHTML` — no precedent
 * either way in this codebase (see this component's own origin research),
 * chosen because the response is a full standalone print-style HTML
 * document with its own `<style>` block, not a fragment: an iframe
 * isolates its layout/CSS from the app shell entirely, the same isolation
 * a real PDF viewer would give the user. `sandbox="allow-same-origin"`
 * only — no `allow-scripts`, since the rendered document is static markup
 * and never needs to execute anything.
 */
export function QuotationPreviewPane({ quotationId }: { quotationId: string | undefined }) {
  const t = useTranslations('quotations');
  const { data, isLoading, isError } = useQuotationPreview(quotationId);

  if (!quotationId) return null;
  if (isLoading) return <LoadingBlock />;
  if (isError || !data) return <p className="p-4 text-sm text-destructive">{t('previewFailed')}</p>;

  return (
    <iframe
      srcDoc={data.html}
      title={t('preview')}
      className="h-full min-h-[70vh] w-full rounded-md border bg-white"
      sandbox="allow-same-origin"
    />
  );
}
