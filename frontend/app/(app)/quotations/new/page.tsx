'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCreateQuotation } from '@/lib/hooks/use-quotations';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { CustomerPicker } from '@/components/domain/customers/customer-picker';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

/**
 * Minimal creation step, on purpose — a Quotation only strictly needs a
 * customer to exist (number is auto-generated, DRAFT, version 1). Every
 * other decision (items, terms, template) happens in the full editor
 * (`/quotations/[id]`) right after, matching this app's own "create the
 * shell, then edit" convention rather than one giant creation form.
 */
export default function NewQuotationPage() {
  const t = useTranslations('quotations');
  const tc = useTranslations('common');
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();
  const createQuotation = useCreateQuotation();

  const [customerId, setCustomerId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!customerId) {
      setError(t('customerRequired'));
      return;
    }
    setError(null);
    try {
      const quotation = await createQuotation.mutateAsync({ customerId });
      router.replace(`/quotations/${quotation.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('newQuotation')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('customer')}</Label>
            <CustomerPicker value={customerId} onChange={(id) => setCustomerId(id)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={handleCreate} loading={createQuotation.isPending}>
            {tc('create')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
