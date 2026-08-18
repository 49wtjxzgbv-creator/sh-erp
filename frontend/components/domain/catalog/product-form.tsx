'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useCompanyUnits } from '@/lib/hooks/use-catalog';
import { useWarehouses } from '@/lib/hooks/use-inventory';
import type { Product, CreateProductInput } from '@/lib/api-client/catalog';
import { toNumber } from '@/lib/api-client/decimal';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EntityPhotoField } from '@/components/domain/files/entity-photo-field';
import { PendingPhotoField } from '@/components/domain/files/pending-photo-field';
import { EntityDocumentsField } from '@/components/domain/files/entity-documents-field';
import { EntitySuppliersEditor } from '@/components/domain/procurement/entity-suppliers-editor';

// Every optional numeric field mirrors backend/src/modules/catalog/dto/create-product.dto.ts
// exactly (@Type(() => Number) + @Min(0) there); zod's z.coerce.number() plays
// the same role client-side for the plain <input type="number"> string values.
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
  unitsPerPackage: z.coerce.number().min(0).optional().or(z.literal('')),
  cell: z.string().optional(),
  minQty: z.coerce.number().min(0).optional().or(z.literal('')),
  localPriceExclVat: z.coerce.number().min(0).optional().or(z.literal('')),
  localPriceInclVat: z.coerce.number().min(0).optional().or(z.literal('')),
  germanPriceExclVat: z.coerce.number().min(0).optional().or(z.literal('')),
  germanPriceInclVat: z.coerce.number().min(0).optional().or(z.literal('')),
  sellPriceEur: z.coerce.number().min(0).optional().or(z.literal('')),
  weightPerUnitKg: z.coerce.number().min(0).optional().or(z.literal('')),
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
  initialQty: z.coerce.number().min(0).optional().or(z.literal('')),
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
}

export function ProductForm({
  product,
  onSubmit,
  submitting,
  submitError,
  pendingPhoto,
  onPendingPhotoChange,
  initialValues,
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

  // Pre-select the company's default warehouse for the "Наявна кількість"
  // field once warehouses load, so the user only has to type a number in
  // the common case — only in create mode, and only if nothing's been
  // picked yet (don't fight a deliberate selection).
  useEffect(() => {
    if (product || initialWarehouseId || !warehouses?.length) return;
    const def = warehouses.find((w) => w.isDefault) ?? warehouses[0];
    setValue('initialWarehouseId', def.id);
  }, [product, initialWarehouseId, warehouses, setValue]);

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
    const numeric = (v: number | '' | undefined) => (v === '' || v === undefined ? undefined : v);
    const { initialQty, initialWarehouseId: warehouseId, ...productValues } = values;
    const qty = numeric(initialQty);
    await onSubmit(
      {
        ...productValues,
        unitsPerPackage: numeric(productValues.unitsPerPackage),
        minQty: numeric(productValues.minQty),
        localPriceExclVat: numeric(productValues.localPriceExclVat),
        localPriceInclVat: numeric(productValues.localPriceInclVat),
        germanPriceExclVat: numeric(productValues.germanPriceExclVat),
        germanPriceInclVat: numeric(productValues.germanPriceInclVat),
        sellPriceEur: numeric(productValues.sellPriceEur),
        weightPerUnitKg: numeric(productValues.weightPerUnitKg),
      },
      !product && qty && qty > 0 && warehouseId ? { warehouseId, qty } : undefined,
    );
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit(submit, scrollToFirstError)} noValidate>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('photo')}</CardTitle>
        </CardHeader>
        <CardContent>
          {product ? (
            <EntityPhotoField domain="PRODUCT_PHOTO" entityType="Product" entityId={product.id} />
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

      {submitError && <p className="text-sm text-destructive">{submitError}</p>}
      <div className="flex justify-end gap-2">
        <Button type="submit" loading={submitting} data-tour="catalog-form-save">
          {tc('save')}
        </Button>
      </div>
    </form>
  );
}
