'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useCompanyUnits } from '@/lib/hooks/use-catalog';
import { useWarehouses } from '@/lib/hooks/use-inventory';
import type { Product, CreateProductInput } from '@/lib/api-client/catalog';
import { toNumber } from '@/lib/api-client/decimal';
import { uploadFile } from '@/lib/api-client/files';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EntityPhotoField } from '@/components/domain/files/entity-photo-field';
import { PendingPhotoField } from '@/components/domain/files/pending-photo-field';
import { EntityDocumentsField, isGlbFile } from '@/components/domain/files/entity-documents-field';
import { EntitySuppliersEditor } from '@/components/domain/procurement/entity-suppliers-editor';
import { dataUrlToFile } from '@/components/domain/bom/use-create-product-from-part';
import { useFilesForEntities } from '@/lib/hooks/use-files';

// Every optional numeric field mirrors backend/src/modules/catalog/dto/create-product.dto.ts
// exactly (@Type(() => Number) + @Min(0) there); zod's z.coerce.number() plays
// the same role client-side for the plain <input type="number"> string values.
//
// Every optional numeric field below is `optionalNonNegativeNumber`, NOT the
// seemingly-equivalent `z.coerce.number().min(0).optional().or(z.literal(''))`
// — that more obvious-looking form has a real bug (caught 2026-10-08: a
// product created with "Вага за одиницю" left blank came back with
// `weightPerUnitKg` stored as a confirmed `0`, not left unset). Root cause:
// `z.coerce.number()` on `''` runs `Number('')`, which in JS is `0` — a valid
// number, not a parse failure — so the branch succeeds with `0` and
// `.or(z.literal(''))` never even gets a chance to catch the blank input.
// `optionalNonNegativeNumber` preprocesses `''`/`null` to `undefined` BEFORE
// the number schema ever sees them, so a blank field reliably comes out as
// `undefined` — the distinction the whole point of an *optional* field rests
// on (e.g. BOM weight roll-up treats "not set" and "confirmed 0" very
// differently, see assemblies.service.ts's `calcAssemblyWeightRecursive`).
const optionalNonNegativeNumber = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z.coerce.number().min(0).optional(),
);

const productSchema = z.object({
  article: z.string().min(1),
  code: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  productGroup: z.string().optional(),
  family: z.string().optional(),
  type: z.string().optional(),
  kind: z.string().optional(),
  productLine: z.string().optional(),
  barcode: z.string().optional(),
  unitId: z.string().uuid(),
  unitsPerPackage: optionalNonNegativeNumber,
  cell: z.string().optional(),
  minQty: optionalNonNegativeNumber,
  localPriceExclVat: optionalNonNegativeNumber,
  localPriceInclVat: optionalNonNegativeNumber,
  germanPriceExclVat: optionalNonNegativeNumber,
  germanPriceInclVat: optionalNonNegativeNumber,
  sellPriceEur: optionalNonNegativeNumber,
  weightPerUnitKg: optionalNonNegativeNumber,
  warrantyMonths: z.string().optional(),
  status: z.string().optional(),
  manufacturer: z.string().optional(),
  manufacturerCode: z.string().optional(),
  countryOfOrigin: z.string().optional(),
  priceListRef: z.string().optional(),
  note: z.string().optional(),
  // Create-mode only, never sent as part of CreateProductInput (Product
  // itself has no writable qty column — see StockService's header comment,
  // it's the single path that mutates WarehouseStock/Product.qty). Stripped
  // out in submit() and reported to the caller separately so it can record
  // a real RECEIVE movement after the product is created.
  initialQty: optionalNonNegativeNumber,
  initialWarehouseId: z.string().optional(),
});

export type ProductFormValues = z.infer<typeof productSchema>;

export function productToFormValues(product?: Product): Partial<ProductFormValues> {
  if (!product) return {};
  return {
    article: product.article,
    code: product.code ?? undefined,
    name: product.name,
    description: product.description ?? undefined,
    category: product.category ?? undefined,
    productGroup: product.productGroup ?? undefined,
    family: product.family ?? undefined,
    type: product.type ?? undefined,
    kind: product.kind ?? undefined,
    productLine: product.productLine ?? undefined,
    barcode: product.barcode ?? undefined,
    unitId: product.unitId,
    unitsPerPackage: toNumber(product.unitsPerPackage) ?? undefined,
    cell: product.cell ?? undefined,
    minQty: toNumber(product.minQty) ?? undefined,
    localPriceExclVat: toNumber(product.localPriceExclVat) ?? undefined,
    localPriceInclVat: toNumber(product.localPriceInclVat) ?? undefined,
    germanPriceExclVat: toNumber(product.germanPriceExclVat) ?? undefined,
    germanPriceInclVat: toNumber(product.germanPriceInclVat) ?? undefined,
    sellPriceEur: toNumber(product.sellPriceEur) ?? undefined,
    weightPerUnitKg: toNumber(product.weightPerUnitKg) ?? undefined,
    warrantyMonths: product.warrantyMonths ?? undefined,
    status: product.status ?? undefined,
    manufacturer: product.manufacturer ?? undefined,
    manufacturerCode: product.manufacturerCode ?? undefined,
    countryOfOrigin: product.countryOfOrigin ?? undefined,
    priceListRef: product.priceListRef ?? undefined,
    note: product.note ?? undefined,
  };
}

export interface InitialStockInput {
  warehouseId: string;
  qty: number;
}

export interface ProductFormProps {
  product?: Product;
  onSubmit: (values: CreateProductInput, initialStock?: InitialStockInput) => Promise<void>;
  submitting: boolean;
  submitError: string | null;
  /** Only used in create mode (no `product` yet) — see PendingPhotoField. */
  pendingPhoto?: File | null;
  onPendingPhotoChange?: (file: File | null) => void;
  /** Create-mode only: seeds fields (e.g. name/initialQty from a recognized invoice line) without a full `Product`. */
  initialValues?: Partial<ProductFormValues>;
  /** View-only: disables every field (a `<fieldset>` wrap, not per-input) and hides the Save button — for a role with `products:read` but not `products:write`. */
  readOnly?: boolean;
  /**
   * "якби я вказував що це за матеріал... воно б рахувало його вагу
   * залежно від обєму і матеріалу" (2026-10-08): the 3D-model part this
   * product is being created from has a known solid volume (mm³, see
   * Step3DViewer's `computeMeshVolume`) — when present, renders a small
   * material picker next to "Вага за одиницю" that turns volume × density
   * into a weight estimate, one click away from filling that field. Omit
   * (or `null`) for every non-3D-model flow — the picker just doesn't
   * render, same as `initialPhoto`/`initialVolumeMm3` on
   * `CreateProductDialog` upstream.
   */
  initialVolumeMm3?: number | null;
  /** "габаритні розміри... площа поверхні" (2026-10-09): world-space bounding box (mm) from the same 3D-model part — shown as a plain informational line next to the weight picker. No `Product` DB field backs this (there isn't one), purely a reference for the user while filling the form in by hand. */
  initialDimensionsMm?: { x: number; y: number; z: number } | null;
  /** Exact mesh surface area (mm²) from the same part — e.g. for eyeballing paint/coating needed. Same informational-only treatment as `initialDimensionsMm`. */
  initialSurfaceAreaMm2?: number | null;
}

/** kg/m³ — standard reference densities, not per-alloy precise; this is a data-entry speed-up (an estimate the user reviews and adjusts), not a certified measurement. */
const MATERIAL_DENSITIES = [
  { key: 'steel', density: 7850 },
  { key: 'stainlessSteel', density: 8000 },
  { key: 'castIron', density: 7200 },
  { key: 'aluminum', density: 2700 },
  { key: 'copper', density: 8960 },
  { key: 'brass', density: 8500 },
  { key: 'plastic', density: 1100 },
] as const;

/** `volumeMm3` is assumed millimeter-scale (see `computeMeshVolume`'s own header comment on why) — 1 m³ = 1e9 mm³, so weight(kg) = volume(mm³) / 1e9 × density(kg/m³). */
function MaterialWeightPicker({ volumeMm3, onApply }: { volumeMm3: number; onApply: (weightKg: number) => void }) {
  const t = useTranslations('catalog');
  // "за замовчуванням стояв розрахунок ваги матеріал сталь і відразу
  // підставлявся в вага за одиницю" (2026-10-09): steel by default
  // (the most common material for this app's parts so far), applied to
  // the weight field the instant this picker mounts — the material
  // dropdown and "Підставити у вагу" button both stay fully usable
  // afterward for picking something else and re-applying by hand.
  const [materialKey, setMaterialKey] = useState<string>('steel');
  const selected = MATERIAL_DENSITIES.find((m) => m.key === materialKey);
  const weightKg = selected ? (volumeMm3 / 1e9) * selected.density : null;

  useEffect(() => {
    if (weightKg !== null) onApply(weightKg);
    // Runs once on mount only — applying again on every `weightKg` change
    // would silently overwrite a value the user already edited by hand
    // after switching materials themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-1.5 rounded-md border border-dashed border-border p-3 sm:col-span-3">
      <Label>{t('materialWeightLabel')}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={materialKey} onValueChange={setMaterialKey}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder={t('materialWeightPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {MATERIAL_DENSITIES.map((m) => (
              <SelectItem key={m.key} value={m.key}>
                {t(`material_${m.key}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {weightKg !== null && (
          <>
            <span className="text-sm text-muted-foreground">{t('materialWeightResult', { weight: weightKg.toFixed(3) })}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => onApply(weightKg)}>
              {t('materialWeightApply')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * "зроби можливість оновити фото в каталозі існуючих товарів якщо фото
 * витягнуло з gbl" (2026-10-08): same shape as `ModelWeightCalculator`
 * below — renders nothing without a `.glb` document attached, loads
 * three.js only on click (`captureGlbSnapshot`, dynamically imported),
 * then re-renders the model's own isolated snapshot and uploads it as a
 * fresh `PRODUCT_PHOTO` (newest wins — see `EntityPhotoField`'s own header
 * comment — so this doesn't need to delete the old one itself). Useful
 * whenever the auto-captured photo from the original "Створити товар" (3D
 * part) flow came out poorly framed, or the attached `.glb` was replaced
 * with a better model since.
 */
function RefreshPhotoFromModel({ productId }: { productId: string }) {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const { data: byEntity } = useFilesForEntities('Product', [productId], 'PRODUCT_DOCUMENT');
  const glbFile = (byEntity?.[productId] ?? []).find((f) => isGlbFile(f.originalName));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!glbFile) return null;

  async function refreshPhoto() {
    setLoading(true);
    setError(null);
    try {
      const { captureGlbSnapshot } = await import('@/components/domain/files/step-3d-viewer');
      const dataUrl = await captureGlbSnapshot(glbFile!.downloadUrl);
      const file = dataUrl ? dataUrlToFile(dataUrl, `${productId}.png`) : null;
      if (!file) {
        setError(t('refreshPhotoFailed'));
        return;
      }
      await uploadFile(file, { domain: 'PRODUCT_PHOTO', entityType: 'Product', entityId: productId });
      qc.invalidateQueries({ queryKey: ['files', 'Product', productId] });
    } catch (err) {
      setError(err instanceof Error ? err.message : tc('error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <Button type="button" variant="outline" size="sm" loading={loading} onClick={refreshPhoto}>
        <RefreshCw className="mr-2 h-4 w-4" />
        {t('refreshPhotoFromModel')}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * "до існуючих товарів де є файл glb додай можливість рахувати вагу"
 * (2026-10-08): the create-mode `MaterialWeightPicker` above gets its
 * `volumeMm3` handed to it from the BOM 3D-viewer flow that created the
 * product in the first place — an already-existing product has no such
 * flow to hook into, but may well have its own `.glb` sitting right there
 * in its documents (`EntityDocumentsField`, domain `PRODUCT_DOCUMENT`).
 * Looks for one; renders nothing if there isn't one. Loads and measures
 * the model (`computeGlbVolume`, dynamically imported — three.js is a
 * heavy client-only dependency not worth pulling into the main catalog
 * bundle for the common case where this button is never clicked) only on
 * the user's own click, not automatically on every page load.
 */
function ModelWeightCalculator({ productId, onApply }: { productId: string; onApply: (weightKg: number) => void }) {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const { data: byEntity } = useFilesForEntities('Product', [productId], 'PRODUCT_DOCUMENT');
  const glbFile = (byEntity?.[productId] ?? []).find((f) => isGlbFile(f.originalName));
  const [volumeMm3, setVolumeMm3] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!glbFile) return null;
  if (volumeMm3 != null) return <MaterialWeightPicker volumeMm3={volumeMm3} onApply={onApply} />;

  async function computeVolume() {
    setLoading(true);
    setError(null);
    try {
      const { computeGlbVolume } = await import('@/components/domain/files/step-3d-viewer');
      const volume = await computeGlbVolume(glbFile!.downloadUrl);
      if (volume == null) setError(t('materialWeightNoVolume'));
      else setVolumeMm3(volume);
    } catch (err) {
      setError(err instanceof Error ? err.message : tc('error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1.5 sm:col-span-3">
      <Button type="button" variant="outline" size="sm" loading={loading} onClick={computeVolume}>
        {t('calculateVolumeFromModel')}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function ProductForm({
  product,
  onSubmit,
  submitting,
  submitError,
  pendingPhoto,
  onPendingPhotoChange,
  initialValues,
  readOnly,
  initialVolumeMm3,
  initialDimensionsMm,
  initialSurfaceAreaMm2,
}: ProductFormProps) {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const tf = useTranslations('files');
  const tp = useTranslations('procurement');
  const { data: units } = useCompanyUnits();
  const { data: warehouses } = useWarehouses();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: { ...productToFormValues(product), ...initialValues },
  });

  const unitId = watch('unitId');
  const initialWarehouseId = watch('initialWarehouseId');

  // "потрібно щоб за замовчуванням стояла одиниця виміру шт" (2026-10-09):
  // same pattern as the default-warehouse effect right below — create mode
  // only, only if nothing's been picked yet (don't fight a deliberate
  // selection), applied the instant the company's units load.
  useEffect(() => {
    if (product || unitId || !units?.length) return;
    const def = units.find((u) => u.name.trim().toLowerCase() === 'шт');
    if (def) setValue('unitId', def.id, { shouldValidate: true });
  }, [product, unitId, units, setValue]);

  // Pre-select the company's default warehouse for the "Наявна кількість"
  // field once warehouses load, so the user only has to type a number in
  // the common case — only in create mode, and only if nothing's been
  // picked yet (don't fight a deliberate selection).
  useEffect(() => {
    if (product || initialWarehouseId || !warehouses?.length) return;
    const def = warehouses.find((w) => w.isDefault) ?? warehouses[0];
    setValue('initialWarehouseId', def.id);
  }, [product, initialWarehouseId, warehouses, setValue]);

  // `useForm`'s `defaultValues` only apply once at mount, so saving a
  // default supplier's price in the "Постачальники" section below (which
  // overwrites sellPriceEur server-side — see ProductsService#setSuppliers)
  // wouldn't otherwise show up here until a full page reload. Re-syncing
  // just this one field (not a blanket `reset()`) avoids clobbering
  // whatever else the user might be mid-editing elsewhere on this form.
  useEffect(() => {
    if (!product) return;
    setValue('sellPriceEur', toNumber(product.sellPriceEur) ?? undefined);
  }, [product?.sellPriceEur, setValue]);

  // Every field's `id` matches its zod schema key (see `id="article"`,
  // `id="unitId"` below), so on failed validation we can generically find
  // and scroll to whichever errored field sits highest on the page —
  // without this, a required-field error (e.g. unitId) renders inline next
  // to that field only, giving no feedback near the Save button and making
  // the page look like it silently did nothing on submit.
  function scrollToFirstError(formErrors: typeof errors) {
    const elements = Object.keys(formErrors)
      .map((key) => document.getElementById(key))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;
    const topmost = elements.reduce((a, b) =>
      a.getBoundingClientRect().top <= b.getBoundingClientRect().top ? a : b,
    );
    topmost.scrollIntoView({ behavior: 'smooth', block: 'center' });
    topmost.focus({ preventScroll: true });
  }

  async function submit(values: ProductFormValues) {
    // No more '' => undefined mapping needed here — `optionalNonNegativeNumber`
    // (see the schema above) already produces a real `number | undefined` for
    // every one of these fields by the time react-hook-form hands them over.
    const { initialQty: qty, initialWarehouseId: warehouseId, ...productValues } = values;
    await onSubmit(
      productValues,
      !product && qty && qty > 0 && warehouseId ? { warehouseId, qty } : undefined,
    );
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit(submit, scrollToFirstError)} noValidate>
      <fieldset disabled={readOnly} className="contents">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('photo')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {product ? (
            <>
              <EntityPhotoField domain="PRODUCT_PHOTO" entityType="Product" entityId={product.id} />
              <RefreshPhotoFromModel productId={product.id} />
            </>
          ) : (
            <PendingPhotoField value={pendingPhoto ?? null} onChange={onPendingPhotoChange ?? (() => {})} />
          )}
        </CardContent>
      </Card>

      {product && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tf('documents')}</CardTitle>
          </CardHeader>
          <CardContent>
            <EntityDocumentsField domain="PRODUCT_DOCUMENT" entityType="Product" entityId={product.id} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('sectionBasic')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="article">{t('article')}</Label>
            <Input id="article" data-tour="catalog-form-article" {...register('article')} />
            {errors.article && <p className="text-xs text-destructive">{tc('requiredField')}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="code">{t('code')}</Label>
            <Input id="code" {...register('code')} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="name">{t('name')}</Label>
            <Input id="name" {...register('name')} />
            {errors.name && <p className="text-xs text-destructive">{tc('requiredField')}</p>}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="description">{t('description')}</Label>
            <Textarea id="description" {...register('description')} />
          </div>
          {product && (
            <div className="space-y-1.5">
              <Label>{t('currentQty')}</Label>
              <Input value={product.qty} disabled />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('sectionClassification')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="category">{t('category')}</Label>
            <Input id="category" {...register('category')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="productGroup">{t('productGroup')}</Label>
            <Input id="productGroup" {...register('productGroup')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="family">{t('family')}</Label>
            <Input id="family" {...register('family')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="type">{t('type')}</Label>
            <Input id="type" {...register('type')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kind">{t('kind')}</Label>
            <Input id="kind" {...register('kind')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="productLine">{t('productLine')}</Label>
            <Input id="productLine" {...register('productLine')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="barcode">{t('barcode')}</Label>
            <Input id="barcode" {...register('barcode')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="status">{t('status')}</Label>
            <Input id="status" {...register('status')} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('sectionUnitsStock')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="unitId">{t('unit')}</Label>
            <Select value={unitId} onValueChange={(v) => setValue('unitId', v, { shouldValidate: true })}>
              <SelectTrigger id="unitId">
                <SelectValue placeholder={t('unit')} />
              </SelectTrigger>
              <SelectContent>
                {units?.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.unitId && <p className="text-xs text-destructive">{tc('requiredField')}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="unitsPerPackage">{t('unitsPerPackage')}</Label>
            <Input id="unitsPerPackage" type="number" step="any" {...register('unitsPerPackage')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="minQty">{t('minQty')}</Label>
            <Input id="minQty" type="number" step="any" {...register('minQty')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cell">{t('cell')}</Label>
            <Input id="cell" {...register('cell')} />
          </div>
          {!product && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="initialQty">{t('initialQty')}</Label>
                <Input id="initialQty" type="number" step="any" min={0} {...register('initialQty')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="initialWarehouseId">{t('initialWarehouse')}</Label>
                <Select
                  value={initialWarehouseId ?? ''}
                  onValueChange={(v) => setValue('initialWarehouseId', v)}
                >
                  <SelectTrigger id="initialWarehouseId">
                    <SelectValue placeholder={t('initialWarehouse')} />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses?.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('sectionPricing')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="sellPriceEur">{t('sellPrice')}</Label>
            <Input id="sellPriceEur" type="number" step="any" {...register('sellPriceEur')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="localPriceExclVat">{t('localPriceExclVat')}</Label>
            <Input id="localPriceExclVat" type="number" step="any" {...register('localPriceExclVat')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="localPriceInclVat">{t('localPriceInclVat')}</Label>
            <Input id="localPriceInclVat" type="number" step="any" {...register('localPriceInclVat')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="germanPriceExclVat">{t('germanPriceExclVat')}</Label>
            <Input id="germanPriceExclVat" type="number" step="any" {...register('germanPriceExclVat')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="germanPriceInclVat">{t('germanPriceInclVat')}</Label>
            <Input id="germanPriceInclVat" type="number" step="any" {...register('germanPriceInclVat')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="priceListRef">{t('priceListRef')}</Label>
            <Input id="priceListRef" {...register('priceListRef')} />
          </div>
        </CardContent>
      </Card>

      {product && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tp('suppliers')}</CardTitle>
          </CardHeader>
          <CardContent>
            <EntitySuppliersEditor entityType="Product" entityId={product.id} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('sectionPhysical')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="weightPerUnitKg">{t('weightPerUnitKg')}</Label>
            <Input id="weightPerUnitKg" type="number" step="any" {...register('weightPerUnitKg')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="warrantyMonths">{t('warrantyMonths')}</Label>
            <Input id="warrantyMonths" {...register('warrantyMonths')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="countryOfOrigin">{t('countryOfOrigin')}</Label>
            <Input id="countryOfOrigin" {...register('countryOfOrigin')} />
          </div>
          {initialVolumeMm3 != null && initialVolumeMm3 > 0 && (
            <MaterialWeightPicker
              volumeMm3={initialVolumeMm3}
              onApply={(weightKg) => setValue('weightPerUnitKg', Number(weightKg.toFixed(3)))}
            />
          )}
          {(initialDimensionsMm || (initialSurfaceAreaMm2 != null && initialSurfaceAreaMm2 > 0)) && (
            <p className="text-xs text-muted-foreground sm:col-span-3">
              {t('modelDimensionsLabel')}{' '}
              {[
                initialDimensionsMm
                  ? `${Math.round(initialDimensionsMm.x)}×${Math.round(initialDimensionsMm.y)}×${Math.round(initialDimensionsMm.z)} мм`
                  : null,
                initialSurfaceAreaMm2 != null && initialSurfaceAreaMm2 > 0 ? `${(initialSurfaceAreaMm2 / 100).toFixed(1)} см²` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
          {product && (
            <ModelWeightCalculator
              productId={product.id}
              onApply={(weightKg) => setValue('weightPerUnitKg', Number(weightKg.toFixed(3)))}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('sectionOther')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="manufacturer">{t('manufacturer')}</Label>
            <Input id="manufacturer" {...register('manufacturer')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manufacturerCode">{t('manufacturerCode')}</Label>
            <Input id="manufacturerCode" {...register('manufacturerCode')} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="note">{t('note')}</Label>
            <Textarea id="note" {...register('note')} />
          </div>
        </CardContent>
      </Card>
      </fieldset>

      {submitError && <p className="text-sm text-destructive">{submitError}</p>}
      {!readOnly && (
        <div className="flex justify-end gap-2">
          <Button type="submit" loading={submitting} data-tour="catalog-form-save">
            {tc('save')}
          </Button>
        </div>
      )}
    </form>
  );
}
