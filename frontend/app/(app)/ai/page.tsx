'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAskHelp } from '@/lib/hooks/use-ai';
import { ApiError } from '@/lib/api-client/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

/**
 * "Довідник" — instruction-only help assistant (ai.service.ts#askHelp).
 * Deliberately single-turn: the backend DTO (AskHelpDto) carries no history
 * field at all, unlike ask-full-assistant, so each question is answered
 * fresh with zero access to live data — matches the legacy design intent of
 * a manual-only assistant that structurally cannot hallucinate real numbers.
 */
export default function AiHelpPage() {
  const t = useTranslations('ai');
  const tc = useTranslations('common');
  const askHelp = useAskHelp();

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setError(null);
    setAnswer(null);
    try {
      const result = await askHelp.mutateAsync(question.trim());
      setAnswer(result.answer);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('help')}</CardTitle>
          <CardDescription>{t('helpDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={handleSubmit}>
            <Textarea
              placeholder={t('questionPlaceholder')}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={2000}
              rows={3}
            />
            <Button type="submit" loading={askHelp.isPending} disabled={!question.trim()}>
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
