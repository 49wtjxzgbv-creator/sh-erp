'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { LanguageSwitcher } from '@/components/domain/shell/language-switcher';
import { Logo } from '@/components/domain/shell/logo';
import { previewInvite, acceptInvite, type SupplierInvitePreview } from '@/lib/supplier-portal/actions';

/**
 * Self-service registration (2026-08-21 P1, ADR-0013) —
 * `/supplier-portal/register?token=...`. No new design: mirrors the
 * existing login page's card/layout exactly, per the same "don't redesign
 * the portal" requirement the whole Supplier Portal has followed so far.
 */
export default function SupplierPortalRegisterPage() {
  const t = useTranslations('supplierPortal');
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [preview, setPreview] = useState<SupplierInvitePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);

  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [organizationName, setOrganizationName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setPreviewError(t('inviteInvalid'));
      setLoadingPreview(false);
      return;
    }
    previewInvite(token)
      .then((p) => setPreview(p))
      .catch(() => setPreviewError(t('inviteInvalid')))
      .finally(() => setLoadingPreview(false));
  }, [token, t]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      await acceptInvite(token, {
        email,
        password,
        organizationName: mode === 'new' ? organizationName : undefined,
      });
      router.replace('/supplier-portal');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t('inviteAcceptFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div className="absolute right-4 top-4 flex items-center gap-1">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex flex-col items-center text-center">
          <Logo size={56} />
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">SH ERP</h1>
          <p className="text-sm text-muted-foreground">by Shyryng</p>
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>{t('registerTitle')}</CardTitle>
            {preview && <CardDescription>{t('registerInvitedBy', { company: preview.companyName })}</CardDescription>}
          </CardHeader>
          <CardContent>
            {loadingPreview ? (
              <p className="text-sm text-muted-foreground">{t('loading')}</p>
            ) : previewError ? (
              <p className="text-sm text-destructive">{previewError}</p>
            ) : (
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={mode === 'new' ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1"
                    onClick={() => setMode('new')}
                  >
                    {t('registerModeNew')}
                  </Button>
                  <Button
                    type="button"
                    variant={mode === 'existing' ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1"
                    onClick={() => setMode('existing')}
                  >
                    {t('registerModeExisting')}
                  </Button>
                </div>
                <form onSubmit={onSubmit} className="space-y-4">
                  {mode === 'new' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="organizationName">{t('registerOrganizationName')}</Label>
                      <Input
                        id="organizationName"
                        required
                        value={organizationName}
                        onChange={(e) => setOrganizationName(e.target.value)}
                      />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="email">{t('email')}</Label>
                    <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password">{t('password')}</Label>
                    <Input
                      id="password"
                      type="password"
                      required
                      minLength={12}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  {submitError && <p className="text-sm text-destructive">{submitError}</p>}
                  <Button type="submit" className="w-full" loading={submitting}>
                    {mode === 'new' ? t('registerSubmitNew') : t('registerSubmitExisting')}
                  </Button>
                </form>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
