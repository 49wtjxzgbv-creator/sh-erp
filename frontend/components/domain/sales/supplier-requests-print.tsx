'use client';

import { useMemo, useState } from 'react';
import { useTranslations, NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { ExternalLink, FileText, Languages } from 'lucide-react';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import type { FileAssetWithUrl } from '@/lib/api-client/files';
import { useProductsByIds, useCompanyUnits } from '@/lib/hooks/use-catalog';
import { generateSupplierRequestDocumentsPdf } from '@/lib/api-client/sales';
import { useTranslateJson } from '@/lib/hooks/use-ai';
import { loadLocaleMessages } from '@/lib/load-locale-messages';
import { locales, type Locale } from '@/lib/i18n-locales';
import { LOCALE_LABELS } from '@/components/domain/shell/language-switcher';
import { formatEur } from '@/lib/utils';
import { PrintArea, PrintDocumentHeader, PreviewButton } from '@/components/domain/print/print-area';
import { usePrintOptions, PrintOptionsDialog, type PrintColumnOption } from '@/components/domain/print/print-options';
import { AssemblyCompositionSection } from '@/components/domain/bom/assembly-spec-print';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export interface SupplierRequestLineForPrint {
  kind?: 'PRODUCT' | 'ASSEMBLY';
  productId?: string;
  subAssemblyId?: string;
  description: string;
  /** Own article/SKU, printed as its own column right after the photo (2026-09-23 user request) — null/undefined when genuinely unset. */
  article?: string | null;
  qty: number;
  /** Which customer order this line came from — only ever set on the multi-order bulk request page (`/sales/shortage-bulk`), where one supplier's printed request can genuinely cover several different orders at once and the recipient needs to know which. Undefined on the single-order page, where every line already belongs to the one order the whole document is for — the column simply doesn't render there. */
  orderNumber?: string;
  /** "конкретну кількість яка потрібна до кожного замовлення саме цього товару" (2026-10-30) — per-order qty breakdown for a merged line, e.g. "1001: 5, 1002: 3" (mergeLinesForPrint, shortage-bulk/page.tsx). Falls back to the plain `orderNumber` in the table cell when unset (single-order page, or a line that was never merged). */
  orderQtyBreakdown?: string;
  /** The resolved supplier's price, null/undefined when unknown — printed only when the "Ціна" column is selected. */
  price?: number | null;
}

export interface SupplierRequestGroupForPrint {
  supplierId?: string;
  supplierName: string;
  lines: SupplierRequestLineForPrint[];
}

export interface SupplierRequestsPrintProps {
  groups: SupplierRequestGroupForPrint[];
  /**
   * Overrides the default `<PreviewButton />` (same-URL `?print=1` reopen).
   * The caller (shortage/page.tsx) needs this because `groups` here is
   * already filtered to a specific supplier and carries the user's
   * live-typed quantities — a same-URL reload in a fresh tab would refetch
   * the raw, unfiltered, unedited shortage preview instead, so the page
   * serializes both the supplier filter and the current quantities into the
   * preview URL itself (same reasoning as product-labels-dialog's own
   * custom `openPreview`).
   */
  onPreview?: () => void;
}

/**
 * Prints the supplier-grouped shortage preview as a set of purchase-request
 * documents ("Заявки постачальникам" in legacy) — one table per supplier,
 * a page break between suppliers, matching the legacy layout. Uses the
 * page's own live `groups` state (the qty the user has actually typed in,
 * not the raw preview) so what prints matches what "Create purchase orders"
 * would actually submit.
 *
 * "Повний склад" (2026-09-22 user request — a supplier line can be a whole
 * виріб/підвиріб bought as one unit (`kind: 'ASSEMBLY'`, "bought whole" per
 * CustomerOrderShortageService's own walkAssembly comment), not just a raw
 * product): ticking "full composition" in print options additionally
 * explodes each ASSEMBLY line's own BOM breakdown below that supplier's
 * table (AssemblyCompositionSection, recursive — same shared component
 * AssemblySpecPrint/PickListPrint/customer-order-print.tsx already use),
 * so what prints isn't just an opaque "виріб X, qty N" line. Off by default
 * — this is internal detail, not necessarily meant for the supplier's own
 * copy of the request.
 *
 * 2026-09-23 user request: an "Артикул" column, always shown right after
 * the photo (not toggleable — unlike the other columns, this isn't
 * optional detail). Comes straight off `ShortageLine.article`
 * (customer-order-shortage.service.ts) — previously only ever folded into
 * `description`'s own "ARTICLE — Name" prefix for a PRODUCT line, and
 * never available at all for an ASSEMBLY line. The `#` row-numbering
 * column is pinned to `.print-index-col` (3ch, globals.css) — `table-
 * layout: fixed` would otherwise give it an equal share of the table
 * width as every text column next to it, same reasoning `.print-photo-col`
 * already documents.
 *
 * "Вкладені документи" (2026-09-23 user request, revised same day): ticking
 * "include attached documents" reveals a "download documents PDF" button.
 * The first version instead embedded each attachment inline into this DOM
 * (`<iframe>`/`<img>`) and relied on `window.print()` — the user reported
 * this "looks bad" because Chromium's print pipeline rasterizes an embedded
 * PDF into a blurry bitmap instead of inserting the real file. The button
 * now POSTs the printable lines' attached-document ids + headings (article
 * + name) to a backend endpoint (SupplierRequestDocumentsPdfService) that
 * merges the real PDF pages (or draws an image attachment onto its own
 * heading page) into one genuine downloadable PDF — never rasterized. CAD
 * sources (STEP/DXF) have no printable page rendering and are skipped, same
 * as before.
 */
export function SupplierRequestsPrint({ groups, onPreview }: SupplierRequestsPrintProps) {
  const t = useTranslations('sales');
  const tp = useTranslations('print');
  const printable = groups.filter((g) => g.lines.some((l) => l.qty > 0));

  // "додай можливість... змінювати мову цієї заявки типу як ми зробили з
  // комерційками" (2026-10-29) — two levels, same as the Quotations
  // language switcher: (1) the static document labels (column headers,
  // "Заявка постачальнику: ..."), switched by rendering the printed
  // content under its own nested NextIntlClientProvider (next-intl's own
  // documented pattern for overriding locale on part of a tree — see
  // SupplierRequestsPrintContent below, the child that actually calls
  // useTranslations and so is the one that needs to sit INSIDE that nested
  // provider); (2) the real catalog text (product/assembly descriptions),
  // AI-translated via the same generic engine the Quotations switcher uses
  // (AiService#translateJson, now exposed as POST /ai/translate-json — see
  // that endpoint's own comment for why it was generalized out of
  // Quotations). `printLocale: null` means "ambient" — the staff member's
  // own UI locale, no override, no translation call, matching this
  // component's behavior before this feature existed byte-for-byte.
  const [printLocale, setPrintLocale] = useState<Locale | null>(null);
  const [printMessages, setPrintMessages] = useState<AbstractIntlMessages | null>(null);
  const [translatedDescriptions, setTranslatedDescriptions] = useState<Record<string, string>>({});
  const translateJson = useTranslateJson();

  const productIds = useMemo(
    () => Array.from(new Set(printable.flatMap((g) => g.lines).filter((l) => l.kind === 'PRODUCT' && l.productId).map((l) => l.productId as string))),
    [printable],
  );
  const assemblyIds = useMemo(
    () =>
      Array.from(
        new Set(printable.flatMap((g) => g.lines).filter((l) => l.kind === 'ASSEMBLY' && l.subAssemblyId).map((l) => l.subAssemblyId as string)),
      ),
    [printable],
  );
  const { data: photosByProduct } = useFilesForEntities('Product', productIds, 'PRODUCT_PHOTO');
  const { data: photosByAssembly } = useFilesForEntities('Assembly', assemblyIds, 'ASSEMBLY_PHOTO');
  const { data: documentsByProduct } = useFilesForEntities('Product', productIds, 'PRODUCT_DOCUMENT');
  const { data: documentsByAssembly } = useFilesForEntities('Assembly', assemblyIds, 'ASSEMBLY_DOCUMENT');
  /** "додай також можливість обирати поле код виробника" (2026-10-29) — only products carry this (catalog.Product.manufacturerCode), never assemblies, so an ASSEMBLY-kind line's column cell is always blank. */
  const { data: productsById } = useProductsByIds(productIds);
  function lineManufacturerCode(line: SupplierRequestLineForPrint): string | null {
    if (line.kind === 'PRODUCT' && line.productId) return productsById?.get(line.productId)?.manufacturerCode ?? null;
    return null;
  }

  /**
   * "хай поруч з цифрою пише шт чи що там вказано в каталозі до кожного
   * товару" (2026-10-30) — the real catalog unit (Product.unitId ->
   * CompanyUnit.name), not a hardcoded "шт", for the per-order qty
   * breakdown below. Assembly has no unit concept of its own
   * (schema.prisma — never carries a unitId, unlike Product) — "шт" is a
   * reasonable fallback label for an ASSEMBLY line, same convention
   * QuotationItemEditor's own default unit already uses.
   */
  const { data: units } = useCompanyUnits();
  const unitNameById = new Map((units ?? []).map((u) => [u.id, u.name]));
  function lineUnit(line: SupplierRequestLineForPrint): string {
    if (line.kind === 'PRODUCT' && line.productId) {
      const unitId = productsById?.get(line.productId)?.unitId;
      return (unitId && unitNameById.get(unitId)) || 'шт';
    }
    return 'шт';
  }

  function lineDownloadUrl(line: SupplierRequestLineForPrint): string | undefined {
    if (line.kind === 'PRODUCT' && line.productId) return photosByProduct?.[line.productId]?.[0]?.downloadUrl;
    if (line.kind === 'ASSEMBLY' && line.subAssemblyId) return photosByAssembly?.[line.subAssemblyId]?.[0]?.downloadUrl;
    return undefined;
  }

  /**
   * "Вкладені документи" (2026-09-23 user request): every PRODUCT_DOCUMENT/
   * ASSEMBLY_DOCUMENT file attached to a line's own product/assembly, each
   * printed on its own full page (.print-document-page, globals.css) with
   * the line's article + name as a page header. Only PDF and image
   * attachments can actually be flattened onto a printed page this way —
   * CAD sources (STEP/DXF) have no printable page rendering here, so those
   * are silently skipped rather than left as dead space.
   */
  function lineDocuments(line: SupplierRequestLineForPrint): FileAssetWithUrl[] {
    if (line.kind === 'PRODUCT' && line.productId) return documentsByProduct?.[line.productId] ?? [];
    if (line.kind === 'ASSEMBLY' && line.subAssemblyId) return documentsByAssembly?.[line.subAssemblyId] ?? [];
    return [];
  }

  function isPrintableDocument(doc: FileAssetWithUrl): boolean {
    return doc.mimeType === 'application/pdf' || doc.mimeType.startsWith('image/');
  }

  /**
   * `description` still carries "ARTICLE — Name" as one string at the
   * source (customer-order-shortage.service.ts — kept as-is there since
   * the on-screen shortage table still shows it combined, with no article
   * column of its own). Now that print has its own dedicated article
   * column, showing that same prefix again in the description cell would
   * just repeat it — strip it here, print-display only.
   */
  function descriptionWithoutArticle(line: SupplierRequestLineForPrint): string {
    if (line.article && line.description.startsWith(`${line.article} — `)) {
      return line.description.slice(line.article.length + 3);
    }
    return line.description;
  }

  /**
   * Keyed `${groupIndex}-${lineIndex}` over the SAME `printable`/`.filter(l
   * => l.qty > 0)` shape the actual render below iterates — must stay in
   * lockstep with that render's own `gi`/`li`, or a translated description
   * would land on the wrong row.
   */
  const descriptionEntries = useMemo(() => {
    const entries: [string, string][] = [];
    printable.forEach((group, gi) => {
      group.lines
        .filter((l) => l.qty > 0)
        .forEach((line, li) => entries.push([`${gi}-${li}`, descriptionWithoutArticle(line)]));
    });
    return entries;
  }, [printable]);

  async function handleSelectLocale(locale: Locale) {
    if (locale === 'uk') {
      // "uk" is this app's own content language (catalog data is always
      // entered in Ukrainian) — resetting to ambient is a true no-op, same
      // rendering as before this feature existed, no AI call needed.
      setPrintLocale(null);
      setPrintMessages(null);
      setTranslatedDescriptions({});
      return;
    }
    setPrintLocale(locale);
    try {
      const [messages, translated] = await Promise.all([
        loadLocaleMessages(locale),
        descriptionEntries.length > 0
          ? translateJson.mutateAsync({
              fields: Object.fromEntries(descriptionEntries),
              targetLocale: locale,
              documentKind: 'заявки постачальнику (назви й описи товарних позицій)',
              usageFeature: 'supplier-request-translate',
            })
          : Promise.resolve({}),
      ]);
      setPrintMessages(messages);
      setTranslatedDescriptions(translated as Record<string, string>);
    } catch {
      // Was a silent, invisible failure before this fix: a rejected
      // loadLocaleMessages/translateJson left printLocale set but
      // printMessages/translatedDescriptions never populated, which left
      // the document stuck on whatever it was rendering before — fully
      // undetectable from the UI. Reset back to ambient so a failure is at
      // least visibly "nothing changed" rather than a confusing half state.
      setPrintLocale(null);
      setPrintMessages(null);
      setTranslatedDescriptions({});
    }
  }

  /** "вказуй до якого саме замовлення чи замовлень відноситься ця заявка" (2026-10-28) — present only on the bulk multi-order page's lines; the single-order page's lines never carry `orderNumber`, so this column option doesn't even exist there and the printed layout stays byte-identical. */
  const hasOrderData = printable.some((g) => g.lines.some((l) => l.orderNumber));

  const columns: PrintColumnOption[] = [
    { id: 'description', label: t('description') },
    { id: 'manufacturerCode', label: t('manufacturerCode') },
    ...(hasOrderData ? [{ id: 'orderNumber', label: t('orderNumber') }] : []),
    { id: 'qtyToOrder', label: t('qtyToOrder') },
    { id: 'unitPrice', label: t('unitPrice') },
    { id: 'price', label: t('expectedPrice') },
    { id: 'composition', label: t('fullComposition') },
    { id: 'documents', label: t('includeAttachedDocuments') },
  ];

  function groupTotal(group: SupplierRequestGroupForPrint): number {
    return group.lines
      .filter((l) => l.qty > 0 && l.price != null)
      .reduce((sum, l) => sum + (l.price as number) * l.qty, 0);
  }
  const printOptions = usePrintOptions({ columns, hasPhotos: true });
  const hasOrderColumn = hasOrderData && printOptions.isColumnVisible('orderNumber');

  const documentItems = useMemo(
    () =>
      printable.flatMap((group) =>
        group.lines
          .filter((l) => l.qty > 0)
          .flatMap((line) =>
            lineDocuments(line)
              .filter(isPrintableDocument)
              .map((doc) => ({
                fileAssetId: doc.id,
                heading: `${line.article ? `${line.article} — ` : ''}${descriptionWithoutArticle(line)}`,
              })),
          ),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lineDocuments/descriptionWithoutArticle close over documentsByProduct/documentsByAssembly/printable, which are already the real deps below.
    [printable, documentsByProduct, documentsByAssembly],
  );

  const downloadDocumentsMutation = useMutation({
    mutationFn: () => generateSupplierRequestDocumentsPdf(documentItems),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  });

  const printContent = (
    <PrintArea printAreaId={printOptions.printAreaId}>
      <SupplierRequestsPrintContent
        printable={printable}
        printOptions={printOptions}
        hasOrderColumn={hasOrderColumn}
        lineDownloadUrl={lineDownloadUrl}
        lineManufacturerCode={lineManufacturerCode}
        lineUnit={lineUnit}
        descriptionWithoutArticle={descriptionWithoutArticle}
        groupTotal={groupTotal}
        translatedDescriptions={translatedDescriptions}
      />
    </PrintArea>
  );

  return (
    <>
      <div className="flex gap-2">
        <PrintOptionsDialog
          open={printOptions.open}
          onOpenChange={printOptions.setOpen}
          columns={columns}
          hasPhotos
          onConfirm={printOptions.confirm}
          triggerLabel={tp('printPurchaseRequest')}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" loading={translateJson.isPending} title={tp('documentLanguage')}>
              <Languages className="mr-2 h-4 w-4" />
              {translateJson.isPending ? tp('translatingDocument') : LOCALE_LABELS[printLocale ?? 'uk']}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {locales.filter((l) => l !== (printLocale ?? 'uk')).map((l) => (
              <DropdownMenuItem key={l} onClick={() => handleSelectLocale(l)}>
                {LOCALE_LABELS[l]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {onPreview ? (
          <Button type="button" variant="outline" size="sm" onClick={onPreview}>
            <ExternalLink className="mr-2 h-4 w-4" />
            {tp('previewAction')}
          </Button>
        ) : (
          <PreviewButton />
        )}
        {printOptions.isColumnVisible('documents') && documentItems.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={downloadDocumentsMutation.isPending}
            onClick={() => downloadDocumentsMutation.mutate()}
          >
            <FileText className="mr-2 h-4 w-4" />
            {t('downloadAttachedDocumentsPdf')}
          </Button>
        )}
      </div>
      {printLocale && printMessages ? (
        <NextIntlClientProvider locale={printLocale} messages={printMessages}>
          {printContent}
        </NextIntlClientProvider>
      ) : (
        printContent
      )}
    </>
  );
}

interface SupplierRequestsPrintContentProps {
  printable: SupplierRequestGroupForPrint[];
  printOptions: ReturnType<typeof usePrintOptions>;
  hasOrderColumn: boolean;
  lineDownloadUrl: (line: SupplierRequestLineForPrint) => string | undefined;
  lineManufacturerCode: (line: SupplierRequestLineForPrint) => string | null;
  lineUnit: (line: SupplierRequestLineForPrint) => string;
  descriptionWithoutArticle: (line: SupplierRequestLineForPrint) => string;
  groupTotal: (group: SupplierRequestGroupForPrint) => number;
  /** AI-translated descriptions keyed `${groupIndex}-${lineIndex}` (see handleSelectLocale above) — falls back to the real (Ukrainian) description when a key is missing, same as before this feature existed. */
  translatedDescriptions: Record<string, string>;
}

/**
 * The actual printed table — split out from `SupplierRequestsPrint` into
 * its own component SPECIFICALLY so its `useTranslations` calls below
 * resolve against whichever `NextIntlClientProvider` is nearest ABOVE this
 * component in the tree. A locale override only reaches descendants that
 * call `useTranslations` themselves — the parent's own already-bound `t`/
 * `tp` (called once, in the OUTER provider, before any nested provider
 * exists) would stay in the ambient language no matter what gets rendered
 * below them, which is exactly the bug this split avoids.
 */
function SupplierRequestsPrintContent({
  printable,
  printOptions,
  hasOrderColumn,
  lineDownloadUrl,
  lineManufacturerCode,
  lineUnit,
  descriptionWithoutArticle,
  groupTotal,
  translatedDescriptions,
}: SupplierRequestsPrintContentProps) {
  const t = useTranslations('sales');
  const tp = useTranslations('print');

  /** "поруч з цифрою пише шт" — appends each order's own unit after its qty: "1001: 5, 1002: 3" -> "1001: 5 шт, 1002: 3 шт". Plain format from mergeLinesForPrint (shortage-bulk/page.tsx), split/rejoined here since that function has no catalog/unit access of its own. */
  function withUnit(breakdown: string | undefined, unit: string): string | undefined {
    if (!breakdown) return breakdown;
    return breakdown
      .split(', ')
      .map((part) => `${part} ${unit}`)
      .join(', ');
  }

  return (
    <>
      <PrintDocumentHeader title={tp('supplierRequestsTitle')} />
      {printable.map((group, gi) => (
        <div key={group.supplierId ?? `none-${gi}`} className={gi < printable.length - 1 ? 'print-page-break' : ''}>
          <h2 className="mb-2 font-semibold">{tp('requestTo')}: {group.supplierName}</h2>
          {hasOrderColumn && (
            <p className="mb-2 text-sm">
              {/* Real bug (2026-10-30): on the multi-order bulk page, a line's own `orderNumber`
                  is ALREADY a comma-joined string when the same product was needed by several
                  orders (mergeLinesForPrint, shortage-bulk/page.tsx) — deduping on the WHOLE
                  joined string (the previous code) left an order number duplicated across the
                  header whenever it appeared in more than one already-joined string (e.g. "1001,
                  1002" + "1002" -> "1001, 1002, 1002"). Splitting each line's own value back into
                  individual numbers BEFORE deduping fixes it regardless of whether a line's
                  orderNumber is a single value (single-order page) or already-joined (bulk page). */}
              {t('orderNumber')}: {Array.from(new Set(group.lines.flatMap((l) => (l.orderNumber ? l.orderNumber.split(', ') : [])))).join(', ')}
            </p>
          )}
          <table className="mb-6">
            <thead>
              <tr>
                <th className="print-index-col">#</th>
                {printOptions.includePhotos && <th className="print-photo-col">{tp('photoColumn')}</th>}
                <th>{t('article')}</th>
                {printOptions.isColumnVisible('description') && <th>{t('description')}</th>}
                {printOptions.isColumnVisible('manufacturerCode') && <th>{t('manufacturerCode')}</th>}
                {hasOrderColumn && <th>{t('orderNumber')}</th>}
                {printOptions.isColumnVisible('qtyToOrder') && <th>{t('qtyToOrder')}</th>}
                {printOptions.isColumnVisible('unitPrice') && <th>{t('unitPrice')}</th>}
                {printOptions.isColumnVisible('price') && <th>{t('expectedPrice')}</th>}
              </tr>
            </thead>
            <tbody>
              {group.lines
                .filter((l) => l.qty > 0)
                .map((line, li) => (
                  <tr key={li}>
                    <td className="print-index-col">{li + 1}</td>
                    {printOptions.includePhotos && (
                      <td>
                        <Avatar src={lineDownloadUrl(line)} size="lg" />
                      </td>
                    )}
                    <td className="font-bold">{line.article ?? ''}</td>
                    {printOptions.isColumnVisible('description') && (
                      <td>{translatedDescriptions[`${gi}-${li}`] ?? descriptionWithoutArticle(line)}</td>
                    )}
                    {printOptions.isColumnVisible('manufacturerCode') && <td>{lineManufacturerCode(line) ?? ''}</td>}
                    {hasOrderColumn && <td>{withUnit(line.orderQtyBreakdown, lineUnit(line)) ?? line.orderNumber ?? ''}</td>}
                    {printOptions.isColumnVisible('qtyToOrder') && <td>{line.qty}</td>}
                    {printOptions.isColumnVisible('unitPrice') && <td>{line.price != null ? formatEur(line.price) : '—'}</td>}
                    {printOptions.isColumnVisible('price') && (
                      <td>{line.price != null ? formatEur(line.price * line.qty) : '—'}</td>
                    )}
                  </tr>
                ))}
            </tbody>
            {printOptions.isColumnVisible('price') && (
              <tfoot>
                <tr>
                  <td
                    colSpan={
                      1 + // #
                      1 + // article — always shown, see the header <th> above
                      (printOptions.includePhotos ? 1 : 0) +
                      (printOptions.isColumnVisible('description') ? 1 : 0) +
                      (printOptions.isColumnVisible('manufacturerCode') ? 1 : 0) +
                      (hasOrderColumn ? 1 : 0) +
                      (printOptions.isColumnVisible('qtyToOrder') ? 1 : 0) +
                      (printOptions.isColumnVisible('unitPrice') ? 1 : 0)
                    }
                    style={{ textAlign: 'right', fontWeight: 600 }}
                  >
                    {tp('supplierRequestTotal')}
                  </td>
                  <td style={{ fontWeight: 600 }}>{formatEur(groupTotal(group))}</td>
                </tr>
              </tfoot>
            )}
          </table>
          {printOptions.isColumnVisible('composition') && (
            <>
              {group.lines
                .filter((l): l is SupplierRequestLineForPrint & { subAssemblyId: string } => l.kind === 'ASSEMBLY' && l.qty > 0 && Boolean(l.subAssemblyId))
                .map((line, li) => (
                  <div key={li} className="mt-4">
                    <h3 className="mb-1 text-sm font-semibold">{line.description} — {t('fullComposition')}</h3>
                    <AssemblyCompositionSection
                      assemblyId={line.subAssemblyId}
                      qty={line.qty}
                      depth={1}
                      showPrice={printOptions.isColumnVisible('unitPrice')}
                    />
                  </div>
                ))}
            </>
          )}
        </div>
      ))}
    </>
  );
}
