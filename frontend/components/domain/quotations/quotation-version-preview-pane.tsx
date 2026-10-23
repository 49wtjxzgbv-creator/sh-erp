'use client';

import { useTranslations } from 'next-intl';
import { useQuotationVersionPreview } from '@/lib/hooks/use-quotations';
import { LoadingBlock } from '@/components/ui/loading-block';

/**
 * "в історії версій попередні версії ми можемо переглядати" (2026-10-23) —
 * same shape as QuotationPreviewPane, pointed at one specific (not
 * necessarily current) version, so a past "Історія версій" entry renders
 * through the exact same QuotationRendererService pipeline instead of a
 * second, hand-rolled approximation. Only fetched while its own dialog is
 * actually open (`enabled`) — a locked version's HTML never changes, so
 * there's nothing to keep live-subscribed once fetched.
 */
export function QuotationVersionPreviewPane({
  quotationId,
  versionId,
  enabled,
}: {
  quotationId: string | undefined;
  versionId: string | undefined;
  enabled: boolean;
}) {
  const t = useTranslations('quotations');
  const { data, isLoading, isError } = useQuotationVersionPreview(quotationId, versionId, enabled);

  if (!enabled) return null;
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
