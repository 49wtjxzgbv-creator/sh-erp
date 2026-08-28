'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { useSessionStore } from '@/lib/auth/session-store';
import { LoadingBlock } from '@/components/ui/loading-block';
import {
  useCompanySettings,
  useUpdateCompanySettings,
  useCompanyBranding,
  useUpdateCompanyBranding,
  useCompanyRequisites,
  useUpdateCompanyRequisites,
} from '@/lib/hooks/use-settings';
import { useChangeOwnPassword } from '@/lib/hooks/use-users';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { toNumber } from '@/lib/api-client/decimal';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { FileUploadField } from '@/components/domain/files/file-upload-field';
import { useHasPermission } from '@/lib/hooks/use-roles';

export default function SettingsPage() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const companyId = useSessionStore((s) => s.companyId);
  const canManageSettings = useHasPermission('settings:manage');
  const canManageImport = useHasPermission('legacy-import:manage');

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      {canManageSettings && <GeneralSettingsCard t={t} tc={tc} />}
      {canManageSettings && companyId && <BrandingCard t={t} tc={tc} companyId={companyId} />}
      {canManageSettings && <RequisitesCard t={t} tc={tc} />}
      {canManageImport && <LegacyImportCard t={t} />}
      <ChangePasswordCard t={t} tc={tc} />
    </div>
  );
}

function LegacyImportCard({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('importFromLegacy')}</CardTitle>
        <CardDescription>{t('importFromLegacyDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Link href="/settings/import">
          <Button variant="outline">
            {t('openWizard')}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

/**
 * Self-service password change (Phase 1 §1.2's `changeOwnPassword` — every
 * authenticated user, not just admins, matches the legacy permission
 * exactly). Backend: `PATCH /users/me/password`, no special permission
 * beyond being logged in.
 */
function ChangePasswordCard({ t, tc }: { t: ReturnType<typeof useTranslations>; tc: ReturnType<typeof useTranslations> }) {
  const apiErrorMessage = useApiErrorMessage();
  const changePassword = useChangeOwnPassword();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await changePassword.mutateAsync({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setSaved(true);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('changePassword')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor="currentPassword">{t('currentPassword')}</Label>
            <Input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="max-w-sm"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="newPassword">{t('newPassword')}</Label>
            <Input
              id="newPassword"
              type="password"
              minLength={12}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="max-w-sm"
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && !error && <p className="text-sm text-success">{t('saveSuccess')}</p>}
          <Button type="submit" loading={changePassword.isPending} disabled={!currentPassword || newPassword.length < 12}>
            {t('changePassword')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function GeneralSettingsCard({ t, tc }: { t: ReturnType<typeof useTranslations>; tc: ReturnType<typeof useTranslations> }) {
  const apiErrorMessage = useApiErrorMessage();
  const { data: settings, isLoading } = useCompanySettings();
  const updateSettings = useUpdateCompanySettings();

  const [vatRatePercent, setVatRatePercent] = useState('');
  const [dashboardWidgets, setDashboardWidgets] = useState('');
  const [dailyDigestEmail, setDailyDigestEmail] = useState('');
  const [dailyDigestEnabled, setDailyDigestEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setVatRatePercent(String(toNumber(settings.vatRatePercent) ?? ''));
    setDashboardWidgets(settings.dashboardWidgets.join(', '));
    setDailyDigestEmail(settings.dailyDigestEmail ?? '');
    setDailyDigestEnabled(settings.dailyDigestEnabled);
  }, [settings]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await updateSettings.mutateAsync({
        vatRatePercent: vatRatePercent === '' ? undefined : Number(vatRatePercent),
        dashboardWidgets: dashboardWidgets
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        dailyDigestEmail: dailyDigestEmail || undefined,
        dailyDigestEnabled,
      });
      setSaved(true);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  if (isLoading) {
    return <LoadingBlock />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor="vatRatePercent">{t('vatRate')}</Label>
            <Input
              id="vatRatePercent"
              type="number"
              step="any"
              min={0}
              max={100}
              value={vatRatePercent}
              onChange={(e) => setVatRatePercent(e.target.value)}
              className="max-w-[160px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dailyDigestEmail">{t('dailyDigestEmail')}</Label>
            <Input
              id="dailyDigestEmail"
              type="email"
              value={dailyDigestEmail}
              onChange={(e) => setDailyDigestEmail(e.target.value)}
              className="max-w-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={dailyDigestEnabled}
              onChange={(e) => setDailyDigestEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            {t('dailyDigestEnabled')}
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && !error && <p className="text-sm text-success">{t('saveSuccess')}</p>}
          <Button type="submit" loading={updateSettings.isPending}>
            {tc('save')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function BrandingCard({
  t,
  tc,
  companyId,
}: {
  t: ReturnType<typeof useTranslations>;
  tc: ReturnType<typeof useTranslations>;
  companyId: string;
}) {
  const apiErrorMessage = useApiErrorMessage();
  const { data: branding, isLoading } = useCompanyBranding();
  const updateBranding = useUpdateCompanyBranding();
  const [error, setError] = useState<string | null>(null);

  async function handleChange(field: 'siteLogoFileId' | 'printLogoFileId' | 'faviconFileId', fileAssetId: string | null) {
    setError(null);
    try {
      await updateBranding.mutateAsync({ [field]: fileAssetId ?? undefined });
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  if (isLoading) {
    return <LoadingBlock />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('branding')}</CardTitle>
        <CardDescription>{t('brandingDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>{t('siteLogo')}</Label>
          <FileUploadField
            domain="BRANDING"
            entityType="Company"
            entityId={companyId}
            isPublic
            value={branding?.siteLogoFileId}
            onChange={(id) => handleChange('siteLogoFileId', id)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t('printLogo')}</Label>
          <FileUploadField
            domain="BRANDING"
            entityType="Company"
            entityId={companyId}
            isPublic
            value={branding?.printLogoFileId}
            onChange={(id) => handleChange('printLogoFileId', id)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t('favicon')}</Label>
          <FileUploadField
            domain="BRANDING"
            entityType="Company"
            entityId={companyId}
            isPublic
            value={branding?.faviconFileId}
            onChange={(id) => handleChange('faviconFileId', id)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * "Реквізити компанії" — legal/contact/bank details, distinct from
 * GeneralSettingsCard (operational config) and BrandingCard (logos). Feeds
 * the Quotation PDF's company-details block when no per-template override
 * is set (QuotationsService#renderVersionHtml's own fallback) — this is the
 * one place that block's text actually comes from for most companies.
 */
function RequisitesCard({ t, tc }: { t: ReturnType<typeof useTranslations>; tc: ReturnType<typeof useTranslations> }) {
  const apiErrorMessage = useApiErrorMessage();
  const { data: requisites, isLoading } = useCompanyRequisites();
  const updateRequisites = useUpdateCompanyRequisites();

  const [legalName, setLegalName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [legalAddress, setLegalAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankIban, setBankIban] = useState('');
  const [bankMfo, setBankMfo] = useState('');
  const [website, setWebsite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!requisites) return;
    setLegalName(requisites.legalName ?? '');
    setTaxId(requisites.taxId ?? '');
    setLegalAddress(requisites.legalAddress ?? '');
    setPhone(requisites.phone ?? '');
    setEmail(requisites.email ?? '');
    setBankName(requisites.bankName ?? '');
    setBankIban(requisites.bankIban ?? '');
    setBankMfo(requisites.bankMfo ?? '');
    setWebsite(requisites.website ?? '');
  }, [requisites]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await updateRequisites.mutateAsync({
        legalName: legalName || undefined,
        taxId: taxId || undefined,
        legalAddress: legalAddress || undefined,
        phone: phone || undefined,
        email: email || undefined,
        bankName: bankName || undefined,
        bankIban: bankIban || undefined,
        bankMfo: bankMfo || undefined,
        website: website || undefined,
      });
      setSaved(true);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  if (isLoading) {
    return <LoadingBlock />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('requisites')}</CardTitle>
        <CardDescription>{t('requisitesDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="legalName">{t('legalName')}</Label>
              <Input id="legalName" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="taxId">{t('taxId')}</Label>
              <Input id="taxId" value={taxId} onChange={(e) => setTaxId(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">{t('phone')}</Label>
              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="legalAddress">{t('legalAddress')}</Label>
              <Input id="legalAddress" value={legalAddress} onChange={(e) => setLegalAddress(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="requisitesEmail">{t('email')}</Label>
              <Input id="requisitesEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="website">{t('website')}</Label>
              <Input id="website" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bankName">{t('bankName')}</Label>
              <Input id="bankName" value={bankName} onChange={(e) => setBankName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bankIban">{t('bankIban')}</Label>
              <Input id="bankIban" value={bankIban} onChange={(e) => setBankIban(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bankMfo">{t('bankMfo')}</Label>
              <Input id="bankMfo" value={bankMfo} onChange={(e) => setBankMfo(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && !error && <p className="text-sm text-success">{t('saveSuccess')}</p>}
          <Button type="submit" loading={updateRequisites.isPending}>
            {tc('save')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
