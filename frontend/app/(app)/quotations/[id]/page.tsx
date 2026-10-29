'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LoadingBlock } from '@/components/ui/loading-block';
import {
  useQuotation,
  useUpdateQuotationTerms,
  useUpdateQuotationNumber,
  useSaveQuotationItems,
  useApproveBelowCost,
  useSendQuotation,
  useCreateNewQuotationVersion,
  useTranslateQuotation,
  useDuplicateQuotation,
  useDeleteQuotation,
  useAcceptQuotation,
  useRejectQuotation,
  useConvertQuotationToOrder,
  useQuotationTemplates,
} from '@/lib/hooks/use-quotations';
import { getFileDownloadUrl } from '@/lib/api-client/files';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { useHasPermission } from '@/lib/hooks/use-roles';
import type { QuotationItemInput, QuotationLocale, QuotationStatus, QuotationVersionItem } from '@/lib/api-client/quotations';
import { QUOTATION_LOCALES } from '@/lib/api-client/quotations';
import { LOCALE_LABELS } from '@/components/domain/shell/language-switcher';
import { QuotationItemEditor, QuotationLiveTotals } from '@/components/domain/quotations/quotation-item-editor';
import { QuotationPreviewPane } from '@/components/domain/quotations/quotation-preview-pane';
import { QuotationVersionPreviewPane } from '@/components/domain/quotations/quotation-version-preview-pane';
import type { QuotationItemDraft } from '@/components/domain/quotations/quotation-item-row';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Languages, Pencil, Check, X } from 'lucide-react';

const STATUS_VARIANT: Record<QuotationStatus, 'secondary' | 'warning' | 'success' | 'destructive' | 'default'> = {
  DRAFT: 'secondary',
  SENT: 'default',
  VIEWED: 'warning',
  ACCEPTED: 'success',
  REJECTED: 'destructive',
};

function itemToDraft(item: QuotationVersionItem): QuotationItemDraft {
  return {
    clientId: item.id,
    serverItemId: item.id,
    kind: item.kind,
    assemblyId: item.assemblyId ?? undefined,
    productId: item.productId ?? undefined,
    nameSnapshot: item.nameSnapshot,
    descriptionSnapshot: item.descriptionSnapshot ?? undefined,
    quantity: Number(item.quantity),
    unit: item.unit,
    pricingSource: item.pricingSource,
    pricingPercent: item.pricingPercent !== null ? Number(item.pricingPercent) : undefined,
    germanPriceMarkupAmount: item.germanPriceMarkupAmount !== null ? Number(item.germanPriceMarkupAmount) : undefined,
    customUnitPrice: item.pricingSource === 'CUSTOM' ? Number(item.unitPrice) : undefined,
    discountPercent: Number(item.discountPercent) || undefined,
    belowCostApproved: item.belowCostApproved,
  };
}

function draftToInput(item: QuotationItemDraft): QuotationItemInput {
  return {
    kind: item.kind,
    assemblyId: item.kind === 'ASSEMBLY' ? item.assemblyId : undefined,
    productId: item.kind === 'PRODUCT' ? item.productId : undefined,
    nameSnapshot: item.kind === 'ASSEMBLY' || item.kind === 'PRODUCT' ? undefined : item.nameSnapshot,
    descriptionSnapshot: item.descriptionSnapshot || undefined,
    quantity: item.quantity,
    unit: item.unit,
    pricingSource: item.pricingSource,
    // Forwarded whenever present, not gated to a specific pricingSource
    // allowlist — the backend's own resolveUnitPrice already disambiguates
    // by pricingSource and simply ignores whichever of these two fields a
    // given source doesn't use, same as customUnitPrice below already does
    // for every non-CUSTOM source. (Was previously gated to MARKUP_PERCENT/
    // COST_PLUS_MARGIN only, which silently broke saving LABOR_MARKUP_PERCENT/
    // LABOR_COST_PLUS_MARGIN lines — fixed in passing while wiring GERMAN_PRICE's
    // own markup, 2026-10-15.)
    pricingPercent: item.pricingPercent,
    germanPriceMarkupAmount: item.germanPriceMarkupAmount,
    customUnitPrice: item.pricingSource === 'CUSTOM' ? item.customUnitPrice : undefined,
    discountPercent: item.discountPercent,
  };
}

export default function QuotationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('quotations');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();

  const { data: quotation, isLoading } = useQuotation(params.id);
  const { data: templates } = useQuotationTemplates();
  const canManage = useHasPermission('quotations:manage');
  const canViewMargin = useHasPermission('quotations:view-margin');
  const canApproveBelowCost = useHasPermission('quotations:approve-below-cost');
  const canConvert = useHasPermission('quotations:convert');

  const saveItems = useSaveQuotationItems(params.id);
  const updateTerms = useUpdateQuotationTerms(params.id);
  const updateNumber = useUpdateQuotationNumber(params.id);
  const approveBelowCost = useApproveBelowCost(params.id);
  const sendQuotation = useSendQuotation(params.id);
  const createNewVersion = useCreateNewQuotationVersion(params.id);
  const translateQuotation = useTranslateQuotation(params.id);
  const duplicateQuotation = useDuplicateQuotation();
  const deleteQuotation = useDeleteQuotation();
  const acceptQuotation = useAcceptQuotation(params.id);
  const rejectQuotation = useRejectQuotation(params.id);
  const convertToOrder = useConvertQuotationToOrder(params.id);

  const currentVersion = quotation?.currentVersion;
  const isLocked = Boolean(currentVersion?.sentAt);
  const editable = canManage && !isLocked;

  const [items, setItems] = useState<QuotationItemDraft[]>([]);
  const [itemsDirty, setItemsDirty] = useState(false);
  const [approvingItemId, setApprovingItemId] = useState<string | undefined>();

  const [validUntil, setValidUntil] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [vatRatePercent, setVatRatePercent] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [deliveryTerms, setDeliveryTerms] = useState('');
  const [installationTerms, setInstallationTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [companyDetailsOverride, setCompanyDetailsOverride] = useState('');
  const [termsDirty, setTermsDirty] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [conversionResult, setConversionResult] = useState<{ customerOrderId: string; warnings: string[] } | null>(null);
  const [mobileTab, setMobileTab] = useState<'editor' | 'preview'>('editor');
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null);

  useEffect(() => {
    if (!currentVersion || itemsDirty) return;
    setItems((currentVersion.items ?? []).map(itemToDraft));
  }, [currentVersion, itemsDirty]);

  useEffect(() => {
    if (!currentVersion || termsDirty) return;
    setValidUntil(currentVersion.validUntil ? currentVersion.validUntil.slice(0, 10) : '');
    setCurrency(currentVersion.currency);
    setTemplateId(currentVersion.templateId ?? undefined);
    setVatRatePercent(currentVersion.vatRatePercent !== null ? String(Number(currentVersion.vatRatePercent)) : '');
    setPaymentTerms(currentVersion.paymentTerms ?? '');
    setDeliveryTerms(currentVersion.deliveryTerms ?? '');
    setInstallationTerms(currentVersion.installationTerms ?? '');
    setNotes(currentVersion.notes ?? '');
    setCompanyDetailsOverride(currentVersion.companyDetailsOverride ?? '');
  }, [currentVersion, termsDirty]);

  if (isLoading || !quotation || !currentVersion) {
    return <LoadingBlock />;
  }

  async function handleSave() {
    setError(null);
    try {
      if (termsDirty) {
        await updateTerms.mutateAsync({
          validUntil: validUntil || undefined,
          currency,
          templateId,
          paymentTerms: paymentTerms || undefined,
          deliveryTerms: deliveryTerms || undefined,
          installationTerms: installationTerms || undefined,
          notes: notes || undefined,
          companyDetailsOverride: companyDetailsOverride.trim() || null,
          vatRatePercent: vatRatePercent === '' ? undefined : Number(vatRatePercent),
        });
        setTermsDirty(false);
      }
      if (itemsDirty) {
        if (items.length === 0) {
          setError(t('addItemBeforeSave'));
          return;
        }
        await saveItems.mutateAsync(items.map(draftToInput));
        setItemsDirty(false);
      }
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleApproveBelowCost(item: QuotationItemDraft) {
    if (!item.serverItemId) return;
    setError(null);
    setApprovingItemId(item.clientId);
    try {
      await approveBelowCost.mutateAsync(item.serverItemId);
      setItems((prev) => prev.map((i) => (i.clientId === item.clientId ? { ...i, belowCostApproved: true } : i)));
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    } finally {
      setApprovingItemId(undefined);
    }
  }

  async function handleSend() {
    setError(null);
    try {
      await sendQuotation.mutateAsync();
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleCreateNewVersion() {
    setError(null);
    try {
      await createNewVersion.mutateAsync();
      setItemsDirty(false);
      setTermsDirty(false);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleTranslate(locale: QuotationLocale) {
    setError(null);
    try {
      await translateQuotation.mutateAsync(locale);
      setItemsDirty(false);
      setTermsDirty(false);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleDuplicate() {
    setError(null);
    try {
      const created = await duplicateQuotation.mutateAsync(params.id);
      router.push(`/quotations/${created.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleDelete() {
    setError(null);
    try {
      await deleteQuotation.mutateAsync(params.id);
      router.push('/quotations');
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleAccept() {
    setError(null);
    try {
      await acceptQuotation.mutateAsync();
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleReject() {
    setError(null);
    try {
      await rejectQuotation.mutateAsync();
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleConvert() {
    setError(null);
    try {
      const result = await convertToOrder.mutateAsync();
      setConversionResult(result);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleDownloadPdf() {
    const pdfFileId = currentVersion?.pdfFileId;
    if (!pdfFileId) return;
    try {
      const { downloadUrl } = await getFileDownloadUrl(pdfFileId);
      window.open(downloadUrl, '_blank');
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handlePrintPdf() {
    const pdfFileId = currentVersion?.pdfFileId;
    if (!pdfFileId) return;
    try {
      const { downloadUrl } = await getFileDownloadUrl(pdfFileId);
      // contentWindow.print() on an iframe pointed straight at the presigned
      // storage URL throws (SecurityError — storage.* is a different origin
      // from this page, so it's blocked exactly like a cross-origin popup
      // would be — confirmed live, that's why the first attempt at this
      // silently fell through to the same window.open() as "Завантажити").
      // R2 already allows a plain CORS fetch for this URL, so fetch the
      // bytes ourselves and build a blob: URL instead — a blob: URL IS
      // same-origin to this page, so the same contentWindow.print() call
      // works on it without that restriction.
      const res = await fetch(downloadUrl);
      if (!res.ok) throw new Error(`Failed to fetch PDF (${res.status})`);
      const blobUrl = URL.createObjectURL(await res.blob());

      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.src = blobUrl;
      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          // Fallback if the embedded print trigger is blocked for any reason — the PDF is still reachable.
          window.open(downloadUrl, '_blank');
        }
      };
      document.body.appendChild(iframe);
      // No reliable 'afterprint' signal from a plugin-rendered PDF — just
      // remove the iframe well after any print dialog would have closed.
      window.setTimeout(() => {
        iframe.remove();
        URL.revokeObjectURL(blobUrl);
      }, 60_000);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  const isExpired =
    (quotation.status === 'SENT' || quotation.status === 'VIEWED') &&
    Boolean(currentVersion.validUntil) &&
    new Date(currentVersion.validUntil as string).getTime() < Date.now();

  const editorPane = (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('terms')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="validUntil">{t('validUntil')}</Label>
            <Input
              id="validUntil"
              type="date"
              value={validUntil}
              disabled={!editable}
              onChange={(e) => {
                setValidUntil(e.target.value);
                setTermsDirty(true);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="currency">{t('currency')}</Label>
            <Select
              value={currency}
              disabled={!editable}
              onValueChange={(v) => {
                setCurrency(v);
                setTermsDirty(true);
              }}
            >
              <SelectTrigger id="currency">
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
            <Label htmlFor="vatRatePercent">{t('vatRatePercent')}</Label>
            <Input
              id="vatRatePercent"
              type="number"
              step="0.1"
              min={0}
              max={100}
              value={vatRatePercent}
              disabled={!editable}
              onChange={(e) => {
                setVatRatePercent(e.target.value);
                setTermsDirty(true);
              }}
            />
            <p className="text-xs text-muted-foreground">{t('vatRatePercentHint')}</p>
          </div>
          {templates && templates.length > 0 && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t('template')}</Label>
              <Select
                value={templateId ?? '__default'}
                onValueChange={(v) => {
                  setTemplateId(v === '__default' ? undefined : v);
                  setTermsDirty(true);
                }}
                disabled={!editable}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default">{t('defaultTemplate')}</SelectItem>
                  {templates.map((tpl) => (
                    <SelectItem key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="paymentTerms">{t('paymentTerms')}</Label>
            <Textarea
              id="paymentTerms"
              value={paymentTerms}
              disabled={!editable}
              onChange={(e) => {
                setPaymentTerms(e.target.value);
                setTermsDirty(true);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deliveryTerms">{t('deliveryTerms')}</Label>
            <Textarea
              id="deliveryTerms"
              value={deliveryTerms}
              disabled={!editable}
              onChange={(e) => {
                setDeliveryTerms(e.target.value);
                setTermsDirty(true);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="installationTerms">{t('installationTerms')}</Label>
            <Textarea
              id="installationTerms"
              value={installationTerms}
              disabled={!editable}
              onChange={(e) => {
                setInstallationTerms(e.target.value);
                setTermsDirty(true);
              }}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="notes">{t('notes')}</Label>
            <Textarea
              id="notes"
              value={notes}
              disabled={!editable}
              onChange={(e) => {
                setNotes(e.target.value);
                setTermsDirty(true);
              }}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="companyDetailsOverride">{t('companyDetailsOverride')}</Label>
            <Textarea
              id="companyDetailsOverride"
              placeholder={t('companyDetailsOverridePlaceholder')}
              value={companyDetailsOverride}
              disabled={!editable}
              onChange={(e) => {
                setCompanyDetailsOverride(e.target.value);
                setTermsDirty(true);
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('items')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <QuotationItemEditor
            items={items}
            currency={currency}
            canViewMargin={canViewMargin}
            editable={editable}
            canApproveBelowCost={canApproveBelowCost}
            onItemsChange={(next) => {
              setItems(next);
              setItemsDirty(true);
            }}
            onApproveBelowCost={handleApproveBelowCost}
            approvingItemId={approvingItemId}
          />
          <QuotationLiveTotals items={items} currency={currency} vatRatePercent={vatRatePercent === '' ? undefined : Number(vatRatePercent)} />
        </CardContent>
      </Card>

      {editable && (
        <Button onClick={handleSave} loading={saveItems.isPending || updateTerms.isPending} disabled={!itemsDirty && !termsDirty}>
          {tc('save')}
        </Button>
      )}

      {(quotation.versionHistory?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('versionHistory')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[currentVersion, ...(quotation.versionHistory ?? [])]
              .sort((a, b) => b.versionNumber - a.versionNumber)
              .map((v) => (
                <div key={v.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span>
                    {t('version')} {v.versionNumber} {v.id === currentVersion.id && `(${t('current')})`}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">
                      {v.sentAt ? `${t('sentAt')}: ${new Date(v.sentAt).toLocaleDateString()}` : t('quotationStatusDRAFT')}
                    </span>
                    <Button variant="outline" size="sm" className="h-7" onClick={() => setViewingVersionId(v.id)}>
                      {t('viewVersion')}
                    </Button>
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      )}
    </div>
  );

  const previewPane = <QuotationPreviewPane quotationId={params.id} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <QuotationNumberHeading
            number={quotation.number}
            canEdit={canManage}
            onSave={async (number) => { await updateNumber.mutateAsync(number); }}
            pending={updateNumber.isPending}
          />
          <Badge variant={STATUS_VARIANT[quotation.status]}>{t(`quotationStatus${quotation.status}`)}</Badge>
          {isExpired && <Badge variant="destructive">{t('quotationStatusEXPIRED')}</Badge>}
          {isLocked && <Badge variant="outline">{t('versionLocked')}</Badge>}
          <Badge variant="outline" title={LOCALE_LABELS[currentVersion.locale]}>
            {currentVersion.locale.toUpperCase()}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {currentVersion.pdfFileId && (
            <Button variant="outline" size="sm" onClick={handleDownloadPdf}>
              {t('downloadPdf')}
            </Button>
          )}
          {currentVersion.pdfFileId && (
            <Button variant="outline" size="sm" onClick={handlePrintPdf}>
              {t('printPdf')}
            </Button>
          )}
          {canManage && (
            <Button variant="outline" size="sm" loading={duplicateQuotation.isPending} onClick={handleDuplicate}>
              {t('duplicate')}
            </Button>
          )}
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" loading={translateQuotation.isPending}>
                  <Languages className="mr-2 h-4 w-4" />
                  {t('translateAction')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {QUOTATION_LOCALES.filter((l) => l !== currentVersion.locale).map((l) => (
                  <DropdownMenuItem key={l} onClick={() => handleTranslate(l)}>
                    {LOCALE_LABELS[l]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {canManage && editable && (
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm">{t('send')}</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('sendConfirmTitle')}</DialogTitle>
                  <DialogDescription>{t('sendConfirmDescription')}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">{tc('cancel')}</Button>
                  </DialogClose>
                  <Button loading={sendQuotation.isPending} onClick={handleSend}>
                    {tc('confirm')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          {canManage && isLocked && quotation.status !== 'ACCEPTED' && quotation.status !== 'REJECTED' && (
            <Button variant="outline" size="sm" loading={createNewVersion.isPending} onClick={handleCreateNewVersion}>
              {t('createNewVersion')}
            </Button>
          )}
          {canManage && (quotation.status === 'SENT' || quotation.status === 'VIEWED') && (
            <>
              <Button variant="outline" size="sm" loading={acceptQuotation.isPending} onClick={handleAccept}>
                {t('markAccepted')}
              </Button>
              <Button variant="destructive" size="sm" loading={rejectQuotation.isPending} onClick={handleReject}>
                {t('markRejected')}
              </Button>
            </>
          )}
          {canConvert && quotation.status === 'ACCEPTED' && !quotation.convertedCustomerOrderId && (
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm">{t('convertToOrder')}</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('convertConfirmTitle')}</DialogTitle>
                  <DialogDescription>{t('convertConfirmDescription')}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">{tc('cancel')}</Button>
                  </DialogClose>
                  <Button loading={convertToOrder.isPending} onClick={handleConvert}>
                    {tc('confirm')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          {quotation.convertedCustomerOrderId && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/sales/${quotation.convertedCustomerOrderId}`}>{t('viewCreatedOrder')}</Link>
            </Button>
          )}
          {canManage && (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  {tc('delete')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('deleteConfirmTitle')}</DialogTitle>
                  <DialogDescription>{t('deleteConfirmDescription')}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">{tc('cancel')}</Button>
                  </DialogClose>
                  <Button variant="destructive" loading={deleteQuotation.isPending} onClick={handleDelete}>
                    {tc('delete')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {conversionResult && (
        <Card className="border-warning">
          <CardContent className="space-y-2 pt-4 text-sm">
            <p className="font-medium">{t('conversionSuccess')}</p>
            {conversionResult.warnings.map((w, i) => (
              <p key={i} className="text-muted-foreground">
                ⚠ {w}
              </p>
            ))}
            <Link href={`/sales/${conversionResult.customerOrderId}`} className="text-primary hover:underline">
              {t('viewCreatedOrder')}
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Desktop: split-pane editor/preview side by side. Mobile: Tabs switch between the two — no precedent for this layout shape anywhere else in the app (see this file's own design research), built fresh for the editor's "live preview" requirement (§8). */}
      <div className="hidden gap-4 lg:grid lg:grid-cols-2">
        <div>{editorPane}</div>
        <div className="sticky top-4 self-start">{previewPane}</div>
      </div>

      <div className="lg:hidden">
        <Tabs value={mobileTab} onValueChange={(v) => setMobileTab(v as 'editor' | 'preview')}>
          <TabsList>
            <TabsTrigger value="editor">{t('editorTab')}</TabsTrigger>
            <TabsTrigger value="preview">{t('previewTab')}</TabsTrigger>
          </TabsList>
          <TabsContent value="editor">{editorPane}</TabsContent>
          <TabsContent value="preview">{previewPane}</TabsContent>
        </Tabs>
      </div>

      <Dialog open={viewingVersionId !== null} onOpenChange={(open) => !open && setViewingVersionId(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {t('version')} {[currentVersion, ...(quotation.versionHistory ?? [])].find((v) => v.id === viewingVersionId)?.versionNumber}
            </DialogTitle>
          </DialogHeader>
          <QuotationVersionPreviewPane quotationId={params.id} versionId={viewingVersionId ?? undefined} enabled={viewingVersionId !== null} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Same inline pencil/Check/X edit pattern as sales/[id]/page.tsx's own ItemQtyCell — number lives on the Quotation row itself (not the current version), so it stays editable even once the version is locked (sent). */
function QuotationNumberHeading({
  number,
  canEdit,
  onSave,
  pending,
}: {
  number: string;
  canEdit: boolean;
  onSave: (number: string) => Promise<void>;
  pending: boolean;
}) {
  const t = useTranslations('quotations');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(number);
  const [localError, setLocalError] = useState<string | null>(null);

  if (!canEdit || !editing) {
    return (
      <div className="flex items-center gap-1">
        <h2 className="text-lg font-semibold">{number}</h2>
        {canEdit && (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => {
              setValue(number);
              setLocalError(null);
              setEditing(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );
  }

  async function handleSave() {
    if (!value.trim()) {
      setLocalError(t('numberRequired'));
      return;
    }
    try {
      await onSave(value.trim());
      setEditing(false);
    } catch (err) {
      setLocalError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Input className="h-7 w-40" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      <Button size="icon" variant="ghost" className="h-6 w-6" loading={pending} onClick={handleSave}>
        <Check className="h-3.5 w-3.5" />
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing(false)}>
        <X className="h-3.5 w-3.5" />
      </Button>
      {localError && <p className="text-xs text-destructive">{localError}</p>}
    </div>
  );
}
