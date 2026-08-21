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
import { previewInvite, acceptInvite, registerStandalone, type SupplierInvitePreview } from '@/lib/supplier-portal/actions';

/**
 * Self-service registration — `/supplier-portal/register`. No new design:
 * mirrors the existing login page's card/layout exactly, per the "don't
 * redesign the portal" requirement the whole Supplier Portal has followed
 * so far. Two distinct flows share this one page/route:
 *
 * - **With `?token=...`** (ADR-0013): a company-generated invite link for a
 *   `Supplier` row that already exists in their ERP. Shows a company-name
 *   banner and a new/existing-account toggle.
 * - **Without a token** (2026-08-21 P2): fully standalone — no company
 *   involved yet. Simplified form (always "new account"); on success there
 *   is no session to redirect into (nothing connected yet) — just a
 *   confirmation to wait for a company to find them by email.
 */
export default function SupplierPortalRegisterPage() {
  const t = useTranslations('supplierPortal');
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [preview, setPreview] = useState<SupplierInvitePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(Boolean(token));

  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [organizationName, setOrganizationName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [standaloneDone, setStandaloneDone] = useState(false);

  useEffect(() => {
    if (!token) return;
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
      if (token) {
        await acceptInvite(token, {
          email,
          password,
          organizationName: mode === 'new' ? organizationName : undefined,
        });
        router.replace('/supplier-portal');
      } else {
        await registerStandalone({ organizationName, email, password });
        setStandaloneDone(true);
      }
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
            {standaloneDone ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{t('registerStandaloneDone')}</p>
                <Link href="/supplier-portal/login" className="text-sm text-primary underline underline-offset-4">
                  {t('signIn')}
                </Link>
              </div>
            ) : loadingPreview ? (
              <p className="text-sm text-muted-foreground">{t('loading')}</p>
            ) : previewError ? (
              <p className="text-sm text-destructive">{previewError}</p>
            ) : (
              <div className="space-y-4">
                {token && (
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
                )}
                <form onSubmit={onSubmit} className="space-y-4">
                  {(mode === 'new' || !token) && (
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
                    {token && mode === 'existing' ? t('registerSubmitExisting') : t('registerSubmitNew')}
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
