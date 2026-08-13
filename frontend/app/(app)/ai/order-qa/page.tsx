'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAskAboutCustomerOrder } from '@/lib/hooks/use-ai';
import { CustomerOrderPicker } from '@/components/domain/sales/customer-order-picker';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

/**
 * Narrowly-scoped Q&A over one specific customer order's real data
 * (ai.service.ts#askAboutCustomerOrder). Single-turn, same as the help
 * assistant — AskAboutCustomerOrderDto carries no history field.
 */
export default function AiOrderQaPage() {
  const t = useTranslations('ai');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const askAboutOrder = useAskAboutCustomerOrder();

  const [orderId, setOrderId] = useState<string | undefined>(undefined);
  const [orderLabel, setOrderLabel] = useState<string | undefined>(undefined);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orderId || !question.trim()) return;
    setError(null);
    setAnswer(null);
    try {
      const result = await askAboutOrder.mutateAsync({ customerOrderId: orderId, question: question.trim() });
      setAnswer(result.answer);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('orderQa')}</CardTitle>
          <CardDescription>{t('orderQaDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <Label>{t('customerOrder')}</Label>
              <CustomerOrderPicker
                value={orderId}
                onChange={(id, label) => {
                  setOrderId(id);
                  setOrderLabel(label);
                }}
              />
              {orderLabel && <p className="text-xs text-muted-foreground">{orderLabel}</p>}
            </div>
            <Textarea
              placeholder={t('questionPlaceholder')}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={2000}
              rows={3}
            />
            <Button type="submit" loading={askAboutOrder.isPending} disabled={!orderId || !question.trim()}>
              {t('ask')}
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {answer && (
        <Card>
          <CardContent className="whitespace-pre-wrap pt-4 text-sm">{answer}</CardContent>
        </Card>
      )}
    </div>
  );
}
