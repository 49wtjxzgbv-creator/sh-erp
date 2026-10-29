'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight, MapPin, ExternalLink } from 'lucide-react';
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
import { useChangeOwnPassword, useMyIpLocation } from '@/lib/hooks/use-users';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { toNumber } from '@/lib/api-client/decimal';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import type { Currency } from '@/lib/api-client/settings';
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
      <MyLocationCard t={t} tc={tc} />
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
 * "отримувати точну геопозицію користувачів" (curiosity, single-user usage —
 * not tied to any tracking/attendance/delivery workflow) — the browser's own
 * Geolocation API, which is the privacy-respecting choice BY CONSTRUCTION:
 * the browser itself shows a one-time native permission prompt per origin,
 * so this can never silently read a location the user didn't just explicitly
 * approve. Deliberately does NOT send the result anywhere — no backend
 * endpoint, no persistence — since there's no stated purpose that would
 * justify storing it; add that only once a real use case needs it.
 */
function MyLocationCard({ t, tc }: { t: ReturnType<typeof useTranslations>; tc: ReturnType<typeof useTranslations> }) {
  const [location, setLocation] = useState<{ latitude: number; longitude: number; accuracy: number; capturedAt: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apiErrorMessage = useApiErrorMessage();
  const ipLocation = useMyIpLocation();

  function handleLocate() {
    if (!('geolocation' in navigator)) {
      setError(t('locationUnsupported'));
      return;
    }
    setLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoading(false);
        setLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, capturedAt: pos.timestamp });
      },
      (err) => {
        setLoading(false);
        if (err.code === err.PERMISSION_DENIED) setError(t('locationPermissionDenied'));
        else if (err.code === err.TIMEOUT) setError(t('locationTimeout'));
        else setError(t('locationUnavailable'));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('myLocation')}</CardTitle>
        <CardDescription>{t('myLocationDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button type="button" variant="outline" onClick={handleLocate} loading={loading}>
          <MapPin className="mr-2 h-4 w-4" />
          {t('getLocationButton')}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {location && (
          <div className="max-w-sm space-y-1.5 rounded-md border border-border bg-secondary/30 p-3 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t('latitude')}</span>
              <span className="tabular-nums">{location.latitude.toFixed(6)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t('longitude')}</span>
              <span className="tabular-nums">{location.longitude.toFixed(6)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t('accuracy')}</span>
              <span className="tabular-nums">
                ±{Math.round(location.accuracy)} {t('metersUnit')}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t('capturedAt')}</span>
              <span className="tabular-nums">{new Date(location.capturedAt).toLocaleString()}</span>
            </div>
            <a
              href={`https://www.google.com/maps?q=${location.latitude},${location.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 pt-1 text-primary hover:underline"
            >
              {t('openInMaps')}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        )}

        <div className="border-t border-border pt-4">
          <p className="mb-2 text-sm font-medium">{t('ipLocation')}</p>
          <p className="mb-3 text-xs text-muted-foreground">{t('ipLocationDescription')}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={ipLocation.isPending}
            onClick={() => ipLocation.mutate()}
          >
            <MapPin className="mr-2 h-4 w-4" />
            {t('getIpLocationButton')}
          </Button>
          {ipLocation.isError && <p className="mt-2 text-sm text-destructive">{apiErrorMessage(ipLocation.error, tc('error'))}</p>}
          {ipLocation.data && !ipLocation.data.found && <p className="mt-2 text-sm text-muted-foreground">{t('ipLocationNotFound')}</p>}
          {ipLocation.data?.found && (
            <div className="mt-3 max-w-sm space-y-1.5 rounded-md border border-border bg-secondary/30 p-3 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{t('ipAddress')}</span>
                <span className="tabular-nums">{ipLocation.data.ip}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{t('city')}</span>
                <span>{ipLocation.data.city || '—'}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{t('region')}</span>
                <span>{ipLocation.data.region || '—'}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{t('country')}</span>
                <span>{ipLocation.data.country || '—'}</span>
              </div>
              {ipLocation.data.latitude != null && ipLocation.data.longitude != null && (
                <a
                  href={`https://www.google.com/maps?q=${ipLocation.data.latitude},${ipLocation.data.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 pt-1 text-primary hover:underline"
                >
                  {t('openInMaps')}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          )}
        </div>
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
  const [baseCurrency, setBaseCurrency] = useState<Currency>('EUR');
  const [dashboardWidgets, setDashboardWidgets] = useState('');
  const [dailyDigestEmail, setDailyDigestEmail] = useState('');
  const [dailyDigestEnabled, setDailyDigestEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setVatRatePercent(String(toNumber(settings.vatRatePercent) ?? ''));
    setBaseCurrency(settings.baseCurrency);
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
        baseCurrency,
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
            <Label htmlFor="baseCurrency">{t('baseCurrency')}</Label>
            <Select value={baseCurrency} onValueChange={(v) => setBaseCurrency(v as Currency)}>
              <SelectTrigger id="baseCurrency" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EUR">EUR</SelectItem>
                <SelectItem value="UAH">UAH</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="PLN">PLN</SelectItem>
              </SelectContent>
            </Select>
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
        legalName: legalName || null,
        taxId: taxId || null,
        legalAddress: legalAddress || null,
        phone: phone || null,
        email: email || null,
        bankName: bankName || null,
        bankIban: bankIban || null,
        bankMfo: bankMfo || null,
        website: website || null,
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
