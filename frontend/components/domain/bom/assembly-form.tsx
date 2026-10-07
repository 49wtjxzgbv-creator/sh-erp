'use client';

import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import type { Assembly, AssemblyComponentLineInput, CreateAssemblyInput } from '@/lib/api-client/bom';
import type { Product } from '@/lib/api-client/catalog';
import { toNumber } from '@/lib/api-client/decimal';
import { useAssemblyComponents, useSetAssemblyComponents } from '@/lib/hooks/use-bom';
import { useProductsByIds } from '@/lib/hooks/use-catalog';
import { queryProducts } from '@/lib/api-client/catalog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EntityPhotoField } from '@/components/domain/files/entity-photo-field';
import { PendingPhotoField } from '@/components/domain/files/pending-photo-field';
import { EntityDocumentsField } from '@/components/domain/files/entity-documents-field';
import { Entity3DModelField } from '@/components/domain/files/entity-3d-model-field';
import { EntitySuppliersEditor } from '@/components/domain/procurement/entity-suppliers-editor';
import { CreateProductDialog } from '@/components/domain/catalog/create-product-dialog';

const assemblySchema = z.object({
  name: z.string().min(1),
  article: z.string().optional(),
  note: z.string().optional(),
  laborCostPerUnit: z.coerce.number().min(0).optional().or(z.literal('')),
  packagingCostPerUnit: z.coerce.number().min(0).optional().or(z.literal('')),
  deliveryCostPerUnit: z.coerce.number().min(0).optional().or(z.literal('')),
  otherCostPerUnit: z.coerce.number().min(0).optional().or(z.literal('')),
  baseSalePriceEur: z.coerce.number().min(0).optional().or(z.literal('')),
  germanPriceEur: z.coerce.number().min(0).optional().or(z.literal('')),
});
type AssemblyFormValues = z.infer<typeof assemblySchema>;

export function assemblyToFormValues(assembly?: Assembly): Partial<AssemblyFormValues> {
  if (!assembly) return {};
  return {
    name: assembly.name,
    article: assembly.article ?? undefined,
    note: assembly.note ?? undefined,
    laborCostPerUnit: toNumber(assembly.laborCostPerUnit) ?? undefined,
    packagingCostPerUnit: toNumber(assembly.packagingCostPerUnit) ?? undefined,
    deliveryCostPerUnit: toNumber(assembly.deliveryCostPerUnit) ?? undefined,
    otherCostPerUnit: toNumber(assembly.otherCostPerUnit) ?? undefined,
    baseSalePriceEur: toNumber(assembly.baseSalePriceEur) ?? undefined,
    germanPriceEur: toNumber(assembly.germanPriceEur) ?? undefined,
  };
}

export interface AssemblyFormProps {
  assembly?: Assembly;
  onSubmit: (values: CreateAssemblyInput) => Promise<void>;
  submitting: boolean;
  submitError: string | null;
  /** Only used in create mode (no `assembly` yet) — see PendingPhotoField. */
  pendingPhoto?: File | null;
  onPendingPhotoChange?: (file: File | null) => void;
  /** View-only for a role with `assemblies:read` but not `assemblies:write`. */
  readOnly?: boolean;
}

export function AssemblyForm({
  assembly,
  onSubmit,
  submitting,
  submitError,
  pendingPhoto,
  onPendingPhotoChange,
  readOnly,
}: AssemblyFormProps) {
  const t = useTranslations('bom');
  const tc = useTranslations('common');
  const tf = useTranslations('files');
  const tp = useTranslations('procurement');

  // "3D-модель — звірка з BOM" (2026-10-08): the assembly's own current
  // PRODUCT-type BOM lines, resolved to real articles — passed down to
  // Step3DViewer (via EntityDocumentsField) so it can flag which 3D-model
  // parts do/don't line up with what's actually in the specification.
  const { data: components } = useAssemblyComponents(assembly?.id);
  const productIds = useMemo(
    () => Array.from(new Set((components ?? []).filter((c) => c.componentType === 'PRODUCT' && c.productId).map((c) => c.productId as string))),
    [components],
  );
  const { data: productsById } = useProductsByIds(productIds);
  const bomArticles = useMemo(
    () => Array.from(productsById?.values() ?? []).map((p) => p.article).filter(Boolean),
    [productsById],
  );

  // "Якщо деталей якихось не має, то має бути кнопка додати до BOM
  // специфікації" + "потрібна кнопка додати все" (2026-10-08): resolves
  // every requested article against this company's own catalog (exact
  // match, case-insensitive — `queryProducts`'s own `search` is a loose
  // `contains`, so this re-filters down to a real match) and appends
  // whichever ones matched as new PRODUCT lines in ONE `setComponents`
  // write — qtyPerUnit defaults to 1, the user adjusts the real quantity
  // afterward in «Склад (BOM)» same as any other line. Doing every article
  // in a single write (rather than one call per article) is required, not
  // just an optimization: `setAssemblyComponents` REPLACES the whole line
  // list from a snapshot of `components`, so calling it repeatedly
  // back-to-back before the snapshot refreshes would silently drop
  // everything but the last addition. `setComponents`'s own `onSuccess`
  // already invalidates this assembly's components query, which is what
  // `bomArticles` above is derived from — no separate refetch wiring
  // needed, the ✅ just appears once the chain above re-renders with the
  // new data.
  const setComponents = useSetAssemblyComponents(assembly?.id ?? '');
  function existingComponentLines(): AssemblyComponentLineInput[] {
    return (components ?? []).map((c) => ({
      componentType: c.componentType,
      productId: c.productId ?? undefined,
      subAssemblyId: c.subAssemblyId ?? undefined,
      warehouseId: c.warehouseId ?? undefined,
      qtyPerUnit: toNumber(c.qtyPerUnit) ?? 0,
    }));
  }
  async function appendProductLines(productIds: string[]): Promise<void> {
    if (productIds.length === 0) return;
    const newLines: AssemblyComponentLineInput[] = productIds.map((productId) => ({
      componentType: 'PRODUCT',
      productId,
      qtyPerUnit: 1,
    }));
    await setComponents.mutateAsync([...existingComponentLines(), ...newLines]);
  }
  async function handleAddToBom(articles: string[]): Promise<{ notFound: string[] }> {
    const notFound: string[] = [];
    const productIds: string[] = [];
    for (const article of articles) {
      const matches = await queryProducts({ search: article, limit: 20 });
      const product = matches.items.find((p) => p.article.trim().toUpperCase() === article.trim().toUpperCase());
      if (product) productIds.push(product.id);
      else notFound.push(article);
    }
    await appendProductLines(productIds);
    return { notFound };
  }

  // "а те чого немає в каталозі запропонувати створити новий товар"
  // (2026-10-08): the 3D viewer bubbles up "create article X, named
  // roughly Y" rather than owning the create-product UI itself (see
  // Step3DViewer's `onCreateProduct` header comment) — this owns the
  // actual dialog and, once the product is created, appends it straight
  // away by id (no need to re-search the catalog for the article we just
  // created it with).
  const [pendingNewProduct, setPendingNewProduct] = useState<{ article: string; name: string } | null>(null);
  function handleCreateProduct(article: string, suggestedName: string) {
    setPendingNewProduct({ article, name: suggestedName });
  }
  async function handleProductCreated(product: Product) {
    setPendingNewProduct(null);
    await appendProductLines([product.id]);
  }

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AssemblyFormValues>({
    resolver: zodResolver(assemblySchema),
    defaultValues: assemblyToFormValues(assembly),
  });

  async function submit(values: AssemblyFormValues) {
    const numeric = (v: number | '' | undefined) => (v === '' || v === undefined ? undefined : v);
    await onSubmit({
      ...values,
      laborCostPerUnit: numeric(values.laborCostPerUnit),
      packagingCostPerUnit: numeric(values.packagingCostPerUnit),
      deliveryCostPerUnit: numeric(values.deliveryCostPerUnit),
      otherCostPerUnit: numeric(values.otherCostPerUnit),
      baseSalePriceEur: numeric(values.baseSalePriceEur),
      germanPriceEur: numeric(values.germanPriceEur),
    });
  }

  // Field `id`s match their zod schema keys (see `id="name"` below) — on
  // failed validation, scroll to the topmost errored field so a required-
  // field error doesn't go unnoticed when the user has scrolled to Save.
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

  return (
    <form className="space-y-4" onSubmit={handleSubmit(submit, scrollToFirstError)} noValidate>
      <fieldset disabled={readOnly} className="contents">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('photo')}</CardTitle>
        </CardHeader>
        <CardContent>
          {assembly ? (
            <EntityPhotoField domain="ASSEMBLY_PHOTO" entityType="Assembly" entityId={assembly.id} />
          ) : (
            <PendingPhotoField value={pendingPhoto ?? null} onChange={onPendingPhotoChange ?? (() => {})} />
          )}
        </CardContent>
      </Card>

      {assembly && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tf('documents')}</CardTitle>
          </CardHeader>
          <CardContent>
            <EntityDocumentsField
              domain="ASSEMBLY_DOCUMENT"
              entityType="Assembly"
              entityId={assembly.id}
              bomArticles={bomArticles}
              onAddToBom={readOnly ? undefined : handleAddToBom}
              onCreateProduct={readOnly ? undefined : handleCreateProduct}
            />
          </CardContent>
        </Card>
      )}

      {assembly && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tf('model3d')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Entity3DModelField domain="ASSEMBLY_3D_MODEL" entityType="Assembly" entityId={assembly.id} />
            <p className="mt-2 text-xs text-muted-foreground">{tf('model3dHint')}</p>
          </CardContent>
        </Card>
      )}

      {assembly && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tp('suppliers')}</CardTitle>
          </CardHeader>
          <CardContent>
            <EntitySuppliersEditor entityType="Assembly" entityId={assembly.id} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('assemblyHeader')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">{t('name')}</Label>
            <Input id="name" {...register('name')} />
            {errors.name && <p className="text-xs text-destructive">{tc('requiredField')}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="article">{t('article')}</Label>
            <Input id="article" {...register('article')} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="note">{t('note')}</Label>
            <Textarea id="note" {...register('note')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="laborCostPerUnit">{t('laborCostPerUnit')}</Label>
            <Input id="laborCostPerUnit" type="number" step="any" {...register('laborCostPerUnit')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="packagingCostPerUnit">{t('packagingCostPerUnit')}</Label>
            <Input id="packagingCostPerUnit" type="number" step="any" {...register('packagingCostPerUnit')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deliveryCostPerUnit">{t('deliveryCostPerUnit')}</Label>
            <Input id="deliveryCostPerUnit" type="number" step="any" {...register('deliveryCostPerUnit')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="otherCostPerUnit">{t('otherCostPerUnit')}</Label>
            <Input id="otherCostPerUnit" type="number" step="any" {...register('otherCostPerUnit')} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('pricingHeader')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5 sm:max-w-xs">
            <Label htmlFor="baseSalePriceEur">{t('baseSalePriceEur')}</Label>
            <Input id="baseSalePriceEur" type="number" step="any" {...register('baseSalePriceEur')} />
            <p className="text-xs text-muted-foreground">{t('baseSalePriceEurHint')}</p>
          </div>
          <div className="mt-4 space-y-1.5 sm:max-w-xs">
            <Label htmlFor="germanPriceEur">{t('germanPriceEur')}</Label>
            <Input id="germanPriceEur" type="number" step="any" {...register('germanPriceEur')} />
            <p className="text-xs text-muted-foreground">{t('germanPriceEurHint')}</p>
          </div>
        </CardContent>
      </Card>
      </fieldset>
      {submitError && <p className="text-sm text-destructive">{submitError}</p>}
      {!readOnly && (
        <Button type="submit" loading={submitting}>
          {tc('save')}
        </Button>
      )}
      <CreateProductDialog
        open={pendingNewProduct !== null}
        onOpenChange={(open) => !open && setPendingNewProduct(null)}
        initialValues={pendingNewProduct ? { article: pendingNewProduct.article, name: pendingNewProduct.name } : undefined}
        onCreated={handleProductCreated}
      />
    </form>
  );
}
