'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAiSettings, useUpdateAiSettings } from '@/lib/hooks/use-ai';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { AiProviderName } from '@/lib/api-client/ai';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { LoadingBlock } from '@/components/ui/loading-block';
import { RequirePermission } from '@/components/domain/auth/require-permission';

const PROVIDERS: AiProviderName[] = ['gemini', 'deepseek'];

/**
 * Bring-your-own Gemini API key + monthly usage quota
 * (ai-settings.service.ts). `hasCustomApiKey` is the only signal the GET
 * endpoint ever returns for the key itself — the plaintext/ciphertext key
 * is never sent back, so this form always renders the key input empty and
 * only sends a new value when the user actually types one. Requires
 * `ai:settings-manage` server-side (not gated client-side, same convention
 * as every other permission-gated page in this project).
 */
export default function AiSettingsPage() {
  const t = useTranslations('ai');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const { data: settings, isLoading } = useAiSettings();
  const updateSettings = useUpdateAiSettings();

  const [provider, setProvider] = useState<AiProviderName>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [monthlyUsageQuota, setMonthlyUsageQuota] = useState('');
  const [contextText, setContextText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setProvider(settings.provider);
    setMonthlyUsageQuota(settings.monthlyUsageQuota != null ? String(settings.monthlyUsageQuota) : '');
    setContextText(settings.contextText);
  }, [settings]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await updateSettings.mutateAsync({
        provider: settings && provider !== settings.provider ? provider : undefined,
        apiKey: apiKey === '' ? undefined : apiKey,
        monthlyUsageQuota: monthlyUsageQuota === '' ? undefined : Number(monthlyUsageQuota),
        contextText: settings && contextText !== settings.contextText ? contextText : undefined,
      });
      setApiKey('');
      setSaved(true);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleClearKey() {
    setError(null);
    setSaved(false);
    try {
      await updateSettings.mutateAsync({ apiKey: '' });
      setApiKey('');
      setSaved(true);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  if (isLoading) {
    return <LoadingBlock />;
  }

  return (
    <RequirePermission permission="ai:settings-manage" redirectTo="/ai">
    <div className="max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('settingsTab')}</CardTitle>
          <CardDescription>{t('settingsDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="contextText">{t('contextText')}</Label>
              <Textarea
                id="contextText"
                placeholder={t('contextTextPlaceholder')}
                value={contextText}
                onChange={(e) => setContextText(e.target.value)}
                rows={4}
                maxLength={2000}
              />
              <p className="text-xs text-muted-foreground">{t('contextTextHint')}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="provider">{t('provider')}</Label>
              <Select value={provider} onValueChange={(v) => setProvider(v as AiProviderName)}>
                <SelectTrigger id="provider" className="max-w-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {t(`provider${p === 'gemini' ? 'Gemini' : 'DeepSeek'}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {provider === 'deepseek' ? t('providerDeepSeekHint') : t('providerGeminiHint')}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="apiKey">{t('apiKey')}</Label>
              <div className="flex items-center gap-2">
                {settings?.hasCustomApiKey ? (
                  <Badge variant="success">{t('apiKeyConfigured')}</Badge>
                ) : (
                  <Badge variant="secondary">{t('apiKeyNotConfigured')}</Badge>
                )}
              </div>
              <Input
                id="apiKey"
                type="password"
                placeholder={t('apiKeyPlaceholder')}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="max-w-sm"
              />
              {settings?.hasCustomApiKey && (
                <Button type="button" variant="ghost" size="sm" onClick={handleClearKey} loading={updateSettings.isPending}>
                  {t('clearApiKey')}
                </Button>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="monthlyUsageQuota">{t('monthlyUsageQuota')}</Label>
              <Input
                id="monthlyUsageQuota"
                type="number"
                min={0}
                step={1}
                placeholder={t('unlimited')}
                value={monthlyUsageQuota}
                onChange={(e) => setMonthlyUsageQuota(e.target.value)}
                className="max-w-[200px]"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {saved && !error && <p className="text-sm text-success">{t('saveSuccess')}</p>}
            <Button type="submit" loading={updateSettings.isPending}>
              {tc('save')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
    </RequirePermission>
  );
}
