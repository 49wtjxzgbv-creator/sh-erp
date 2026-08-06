'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { useCompanyUnits } from '@/lib/hooks/use-catalog';
import type { Product, CreateProductInput } from '@/lib/api-client/catalog';
import { toNumber } from '@/lib/api-client/decimal';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EntityPhotoField } from '@/components/domain/files/entity-photo-field';

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

export interface ProductFormProps {
  product?: Product;
  onSubmit: (values: CreateProductInput) => Promise<void>;
  submitting: boolean;
  submitError: string | null;
}

export function ProductForm({ product, onSubmit, submitting, submitError }: ProductFormProps) {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const { data: units } = useCompanyUnits();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: productToFormValues(product),
  });

  const unitId = watch('unitId');

  async function submit(values: ProductFormValues) {
    const numeric = (v: number | '' | undefined) => (v === '' || v === undefined ? undefined : v);
    await onSubmit({
      ...values,
      unitsPerPackage: numeric(values.unitsPerPackage),
      minQty: numeric(values.minQty),
      localPriceExclVat: numeric(values.localPriceExclVat),
      localPriceInclVat: numeric(values.localPriceInclVat),
      germanPriceExclVat: numeric(values.germanPriceExclVat),
      germanPriceInclVat: numeric(values.germanPriceInclVat),
      sellPriceEur: numeric(values.sellPriceEur),
      weightPerUnitKg: numeric(values.weightPerUnitKg),
    });
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit(submit)} noValidate>
      {product && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('photo')}</CardTitle>
          </CardHeader>
          <CardContent>
            <EntityPhotoField domain="PRODUCT_PHOTO" entityType="Product" entityId={product.id} />
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
            <Input id="article" {...register('article')} />
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
        <Button type="submit" loading={submitting}>
          {tc('save')}
        </Button>
      </div>
    </form>
  );
}
