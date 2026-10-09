'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { Box, Check, Loader2, Plus, RefreshCw } from 'lucide-react';
import { analyzeGlbParts, type GlbModelAnalysis, type GlbPartAnalysis } from '@/components/domain/files/step-3d-viewer';
import { isGlbFile } from '@/components/domain/files/entity-documents-field';
import { useAssemblyBomArticles, useAssemblyBomActions } from '@/lib/hooks/use-bom';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { useCreateProductFromPart, dataUrlToFile } from '@/components/domain/bom/use-create-product-from-part';
import { useCreateAssemblyFromPart } from '@/components/domain/bom/use-create-assembly-from-part';
import { CreateProductDialog } from '@/components/domain/catalog/create-product-dialog';
import { CreateAssemblyDialog } from '@/components/domain/bom/create-assembly-dialog';
import { getProductsByArticles, type Product } from '@/lib/api-client/catalog';
import type { Assembly } from '@/lib/api-client/bom';
import { uploadFile } from '@/lib/api-client/files';
import { cn } from '@/lib/utils';

interface ResolvedPart extends GlbPartAnalysis {
  product: Product | null;
}

/** "габаритні розміри... площа поверхні" (2026-10-09): compact one-line summary shown right on the part card — `null` dimensions or a zero area (see `GlbPartAnalysis`'s own field comments) just omit that half. */
function formatDimensionsAndArea(part: GlbPartAnalysis): string | null {
  const bits: string[] = [];
  if (part.dimensionsMm) {
    const { x, y, z } = part.dimensionsMm;
    bits.push(`${Math.round(x)}×${Math.round(y)}×${Math.round(z)} мм`);
  }
  if (part.surfaceAreaMm2 > 0) {
    bits.push(`${(part.surfaceAreaMm2 / 100).toFixed(1)} см²`);
  }
  return bits.length > 0 ? bits.join(' · ') : null;
}

/**
 * "через раз то відкриває то ні" (2026-10-08, real user report): this used
 * to fire one `queryProducts` request PER distinct part (up to a few dozen
 * for a real assembly, even with concurrency capped) — the exact same
 * failure mode `ProductsService.bulkRemove`'s own header comment already
 * documents from a past incident: N parallel per-row requests blow
 * straight through the global per-client rate limit
 * (`app.module.ts`'s `ThrottlerModule`, 100 req/60s), so whichever
 * requests didn't fit under whatever budget was left that moment 429'd —
 * intermittent by nature, since it depends on everything ELSE the same
 * client did in the preceding minute. `getProductsByArticles` resolves
 * every part's article in ONE request instead (see
 * `GET /products/batch-by-article`), the same fix already applied to the
 * bulk-delete case.
 */
async function resolveAgainstCatalog(parts: GlbPartAnalysis[]): Promise<ResolvedPart[]> {
  const products = await getProductsByArticles(parts.map((p) => p.article));
  const byArticle = new Map(products.map((p) => [p.article.trim().toUpperCase(), p]));
  return parts.map((part) => ({ ...part, product: byArticle.get(part.article.trim().toUpperCase()) ?? null }));
}

export interface AssemblyPartsCheckViewerProps {
  assemblyId: string;
  glbUrl: string;
  readOnly?: boolean;
}

/**
 * Heavy half of `assembly-parts-check.tsx` — parses the assembly's 3D
 * model (headless, no visible canvas — see `analyzeGlbParts`), resolves
 * every distinct part against the catalog, and renders the flat
 * "у каталозі" / "немає в каталозі" lists with add/create actions. Lazy
 * `next/dynamic`-loaded (`ssr: false`) from `assembly-parts-check.tsx` so
 * three.js only enters this one tab's chunk, not every BOM tab's.
 */
export function AssemblyPartsCheckViewer({ assemblyId, glbUrl, readOnly }: AssemblyPartsCheckViewerProps) {
  const t = useTranslations('bom');
  const tf = useTranslations('files');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [parts, setParts] = useState<ResolvedPart[]>([]);
  // "коли тут створюєш товар то не додається до нього файл gbl" (2026-10-08):
  // the analysis keeps the parsed model alive (see `analyzeGlbParts`'s own
  // `dispose` comment) specifically so a part's standalone .glb can be
  // exported on demand — at "Створити товар" time, not up front for every
  // part. Disposed on unmount/glbUrl-change below.
  const analysisRef = useRef<GlbModelAnalysis | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    (async () => {
      try {
        const analysis = await analyzeGlbParts(glbUrl);
        if (cancelled) {
          analysis.dispose();
          return;
        }
        analysisRef.current = analysis;
        const resolved = await resolveAgainstCatalog(analysis.parts);
        if (cancelled) return;
        setParts(resolved);
        setState('ready');
      } catch (err) {
        console.error('[AssemblyPartsCheckViewer] failed to analyze model:', err);
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
      analysisRef.current?.dispose();
      analysisRef.current = null;
    };
  }, [glbUrl]);

  const { bomArticles } = useAssemblyBomArticles(assemblyId);
  const bomSet = new Set(bomArticles.map((a) => a.trim().toUpperCase()));
  const { appendProductLines } = useAssemblyBomActions(assemblyId);
  const { pending, requestCreate, dialogProps } = useCreateProductFromPart(appendProductLines);
  const { requestCreate: requestCreateAssembly, dialogProps: assemblyDialogProps } = useCreateAssemblyFromPart();
  const [pendingArticles, setPendingArticles] = useState<Set<string>>(new Set());
  const [exportingArticles, setExportingArticles] = useState<Set<string>>(new Set());
  const [exportingAssemblyArticles, setExportingAssemblyArticles] = useState<Set<string>>(new Set());
  const [updatingPhotoArticles, setUpdatingPhotoArticles] = useState<Set<string>>(new Set());
  const [attachingGlbArticles, setAttachingGlbArticles] = useState<Set<string>>(new Set());
  const qc = useQueryClient();

  // "можна ще окрім фото додавати gbl до існуючих товарів в яких gbl
  // відсутній" (2026-10-08): one batch request for every matched product's
  // documents (same `getProductsByArticles`-style fix as `resolveAgainstCatalog`
  // above — N individual per-row requests is the exact rate-limit incident
  // this app already got burned by once) — just to know which ones already
  // have a `.glb` attached, so "Додати GLB" only shows up where it's
  // actually missing.
  const inCatalogProductIds = parts.map((p) => p.product?.id).filter((id): id is string => Boolean(id));
  const { data: productDocsByEntity } = useFilesForEntities('Product', inCatalogProductIds, 'PRODUCT_DOCUMENT');
  function hasGlbAttached(productId: string | undefined): boolean {
    if (!productId) return false;
    return (productDocsByEntity?.[productId] ?? []).some((f) => isGlbFile(f.originalName));
  }

  async function handleCreateClick(part: ResolvedPart) {
    setExportingArticles((prev) => new Set(prev).add(part.article));
    try {
      const glb = (await analysisRef.current?.exportPartGlb(part.nodeId)) ?? null;
      requestCreate(part.article, part.name, part.qty, part.photoDataUrl, glb, part.volumeMm3, part.dimensionsMm, part.surfaceAreaMm2);
    } finally {
      setExportingArticles((prev) => {
        const next = new Set(prev);
        next.delete(part.article);
        return next;
      });
    }
  }

  // "якщо створюємо специфікацію також автоматично має підтягуватися фото
  // назва артикул і glb файл" (2026-10-09): same "reuse the kept-alive
  // group via exportPartGlb" reasoning as `handleCreateClick` above, just
  // feeding `useCreateAssemblyFromPart` instead of the product one.
  async function handleCreateSpecClick(part: ResolvedPart) {
    setExportingAssemblyArticles((prev) => new Set(prev).add(part.article));
    try {
      const glb = (await analysisRef.current?.exportPartGlb(part.nodeId)) ?? null;
      requestCreateAssembly(part.article, part.name, part.photoDataUrl, glb);
    } finally {
      setExportingAssemblyArticles((prev) => {
        const next = new Set(prev);
        next.delete(part.article);
        return next;
      });
    }
  }

  // "коли там натискаємо створити специфікацію то відкривай в новій
  // вкладці а не в цій самій" (2026-10-09): this check-viewer tab stays
  // open (its own `analysisRef`-held model is what the NEXT "Створити
  // специфікацію" click would reuse) so the just-created assembly opens
  // alongside it instead of navigating the current tab away.
  async function handleAssemblyCreated(assembly: Assembly) {
    await assemblyDialogProps.onCreated(assembly);
    window.open(`/bom/${assembly.id}/components`, '_blank');
  }

  // The one-time `analyzeGlbParts` + catalog-resolution pass (the effect
  // above) never re-runs after this — otherwise every "Створити товар"
  // would re-parse the whole model and re-query the catalog for every
  // part again. So a just-created product has to be patched into the
  // already-resolved `parts` state directly, or the row would keep
  // showing "Немає в каталозі"/"Створити товар" for a part that now DOES
  // have a product (and is already in the BOM, via `dialogProps`'s own
  // `onCreated`). `pending?.article` is read BEFORE awaiting — the hook's
  // own `onCreated` clears `pending` as part of handling the call.
  async function handleCreated(product: Product) {
    const article = pending?.article;
    await dialogProps.onCreated(product);
    if (article) {
      setParts((prev) => prev.map((p) => (p.article === article ? { ...p, product } : p)));
    }
  }

  // "саме з сецифікації бум з деталі 3д тих товарів які є в каталозі
  // оновити їх фото" (2026-10-08): the snapshot already sitting in
  // `part.photoDataUrl` IS this GLB's own current render of the part — no
  // second model load needed, just upload it as that matched product's
  // new photo (newest wins, see `EntityPhotoField`'s own header comment).
  async function handleRefreshPhoto(part: ResolvedPart) {
    if (!part.product || !part.photoDataUrl) return;
    const productId = part.product.id;
    setUpdatingPhotoArticles((prev) => new Set(prev).add(part.article));
    try {
      const file = dataUrlToFile(part.photoDataUrl, `${part.product.article}.png`);
      if (file) {
        await uploadFile(file, { domain: 'PRODUCT_PHOTO', entityType: 'Product', entityId: productId });
        qc.invalidateQueries({ queryKey: ['files', 'Product', productId] });
      }
    } finally {
      setUpdatingPhotoArticles((prev) => {
        const next = new Set(prev);
        next.delete(part.article);
        return next;
      });
    }
  }

  // Same "can't re-run analyzeGlbParts per click" reasoning as
  // `handleCreateClick`'s own `exportPartGlb` call — reuses the SAME kept-
  // alive `group` (`analysisRef`), no second fetch/parse of the whole
  // model just to attach one part's own standalone .glb.
  async function handleAttachGlb(part: ResolvedPart) {
    if (!part.product) return;
    const productId = part.product.id;
    setAttachingGlbArticles((prev) => new Set(prev).add(part.article));
    try {
      const glb = (await analysisRef.current?.exportPartGlb(part.nodeId)) ?? null;
      if (glb) {
        const glbFile = new File([glb], `${part.product.article}.glb`, { type: 'model/gltf-binary' });
        await uploadFile(glbFile, { domain: 'PRODUCT_DOCUMENT', entityType: 'Product', entityId: productId });
        qc.invalidateQueries({ queryKey: ['files-batch', 'Product'] });
      }
    } finally {
      setAttachingGlbArticles((prev) => {
        const next = new Set(prev);
        next.delete(part.article);
        return next;
      });
    }
  }

  async function handleAdd(part: ResolvedPart) {
    if (!part.product) return;
    setPendingArticles((prev) => new Set(prev).add(part.article));
    try {
      await appendProductLines([{ productId: part.product.id, qty: part.qty }]);
    } finally {
      setPendingArticles((prev) => {
        const next = new Set(prev);
        next.delete(part.article);
        return next;
      });
    }
  }

  if (state === 'loading') {
    return <p className="text-sm text-muted-foreground">{tf('loadingModel')}</p>;
  }
  if (state === 'error') {
    return <p className="text-sm text-destructive">{tf('modelLoadError')}</p>;
  }
  if (parts.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('partsCheckEmpty')}</p>;
  }

  // "деталі які складаються з одної а є деталі які складаються з
  // декількох... ті які складаються з декількох то це підвиріб"
  // (2026-10-09): a candidate whose own subtree has more than one mesh
  // isn't a simple part — "Створити товар" doesn't make sense for it (a
  // real example: a node that LOOKED like a plain article turned out to
  // bundle 184 unrelated fasteners as a CAD-export selection-group, not
  // one physical thing). Split out into their own section instead of
  // mixing them into the simple-parts lists; the user decides by hand
  // whether each one is a real sub-assembly worth its own specification.
  const simpleParts = parts.filter((p) => p.meshCount <= 1);
  const multiPieceParts = parts.filter((p) => p.meshCount > 1);
  const inCatalog = simpleParts.filter((p) => p.product);
  const notInCatalog = simpleParts.filter((p) => !p.product);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t('partsCheckInCatalog', { count: inCatalog.length })}</h2>
        {inCatalog.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('partsCheckNone')}</p>
        ) : (
          <PartsGrid
            parts={inCatalog}
            bomSet={bomSet}
            pendingArticles={pendingArticles}
            updatingPhotoArticles={updatingPhotoArticles}
            attachingGlbArticles={attachingGlbArticles}
            hasGlbAttached={hasGlbAttached}
            readOnly={readOnly}
            onAdd={handleAdd}
            onRefreshPhoto={handleRefreshPhoto}
            onAttachGlb={handleAttachGlb}
            addLabel={t('partsCheckAdd')}
            addedLabel={t('partsCheckAdded')}
            refreshPhotoLabel={t('partsCheckRefreshPhoto')}
            attachGlbLabel={t('partsCheckAttachGlb')}
          />
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t('partsCheckNotInCatalog', { count: notInCatalog.length })}</h2>
        {notInCatalog.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('partsCheckNone')}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {notInCatalog.map((part) => (
              <li key={part.article} className="flex flex-col gap-2 rounded-md border border-border p-2">
                <PartThumb part={part} />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium" title={part.article}>{part.article}</p>
                  <p className="truncate text-xs text-muted-foreground" title={part.name}>{part.name}</p>
                  {formatDimensionsAndArea(part) && <p className="truncate text-[10px] text-muted-foreground">{formatDimensionsAndArea(part)}</p>}
                  {part.qty > 1 && <p className="text-xs text-muted-foreground">×{part.qty}</p>}
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => handleCreateClick(part)}
                    disabled={exportingArticles.has(part.article)}
                    className="flex items-center justify-center gap-1.5 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-secondary/50 disabled:opacity-50"
                  >
                    {exportingArticles.has(part.article) ? <Loader2 className="h-3 w-3 animate-spin" /> : tf('createProduct')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t('partsCheckAssemblies', { count: multiPieceParts.length })}</h2>
        <p className="text-xs text-muted-foreground">{t('partsCheckAssembliesHint')}</p>
        {multiPieceParts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('partsCheckNone')}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {multiPieceParts.map((part) => (
              <li key={part.article} className="flex flex-col gap-2 rounded-md border border-border p-2">
                <PartThumb part={part} />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium" title={part.article}>{part.article}</p>
                  <p className="truncate text-xs text-muted-foreground" title={part.name}>{part.name}</p>
                  <p className="text-xs text-muted-foreground">{t('partsCheckMeshCount', { count: part.meshCount })}</p>
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => handleCreateSpecClick(part)}
                    disabled={exportingAssemblyArticles.has(part.article)}
                    className="flex items-center justify-center gap-1.5 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-secondary/50 disabled:opacity-50"
                  >
                    {exportingAssemblyArticles.has(part.article) ? <Loader2 className="h-3 w-3 animate-spin" /> : t('partsCheckCreateAssembly')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <CreateProductDialog {...dialogProps} onCreated={handleCreated} />
      <CreateAssemblyDialog {...assemblyDialogProps} onCreated={handleAssemblyCreated} />
    </div>
  );
}

function PartThumb({ part }: { part: GlbPartAnalysis }) {
  return (
    <div className="flex aspect-square items-center justify-center overflow-hidden rounded bg-secondary/30">
      {part.photoDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a same-process data URL, never a remote URL next/image would optimize
        <img src={part.photoDataUrl} alt={part.article} className="h-full w-full object-contain" />
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      )}
    </div>
  );
}

function PartsGrid({
  parts,
  bomSet,
  pendingArticles,
  updatingPhotoArticles,
  attachingGlbArticles,
  hasGlbAttached,
  readOnly,
  onAdd,
  onRefreshPhoto,
  onAttachGlb,
  addLabel,
  addedLabel,
  refreshPhotoLabel,
  attachGlbLabel,
}: {
  parts: ResolvedPart[];
  bomSet: Set<string>;
  pendingArticles: Set<string>;
  updatingPhotoArticles: Set<string>;
  attachingGlbArticles: Set<string>;
  hasGlbAttached: (productId: string | undefined) => boolean;
  readOnly?: boolean;
  onAdd: (part: ResolvedPart) => void;
  onRefreshPhoto: (part: ResolvedPart) => void;
  onAttachGlb: (part: ResolvedPart) => void;
  addLabel: string;
  addedLabel: string;
  refreshPhotoLabel: string;
  attachGlbLabel: string;
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {parts.map((part) => {
        const inBom = part.product ? bomSet.has(part.product.article.trim().toUpperCase()) : false;
        const pending = pendingArticles.has(part.article);
        const updatingPhoto = updatingPhotoArticles.has(part.article);
        const attachingGlb = attachingGlbArticles.has(part.article);
        const needsGlb = !hasGlbAttached(part.product?.id);
        return (
          <li key={part.article} className="flex flex-col gap-2 rounded-md border border-border p-2">
            <PartThumb part={part} />
            <div className="min-w-0">
              <p className="truncate text-xs font-medium" title={part.product?.article ?? part.article}>
                {part.product?.article ?? part.article}
              </p>
              <p className="truncate text-xs text-muted-foreground" title={part.product?.name ?? part.name}>
                {part.product?.name ?? part.name}
              </p>
              {formatDimensionsAndArea(part) && <p className="truncate text-[10px] text-muted-foreground">{formatDimensionsAndArea(part)}</p>}
              {part.qty > 1 && <p className="text-xs text-muted-foreground">×{part.qty}</p>}
            </div>
            {!readOnly && (
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => onAdd(part)}
                  disabled={inBom || pending}
                  className={cn(
                    'flex items-center justify-center gap-1.5 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-secondary/50 disabled:opacity-50',
                    inBom && 'border-none bg-transparent text-success hover:bg-transparent',
                  )}
                >
                  {inBom ? (
                    <>
                      <Check className="h-3 w-3" /> {addedLabel}
                    </>
                  ) : pending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <>
                      <Plus className="h-3 w-3" /> {addLabel}
                    </>
                  )}
                </button>
                {(part.photoDataUrl || needsGlb) && (
                  <div className="flex items-center gap-1.5">
                    {part.photoDataUrl && (
                      <button
                        type="button"
                        onClick={() => onRefreshPhoto(part)}
                        disabled={updatingPhoto}
                        title={refreshPhotoLabel}
                        aria-label={refreshPhotoLabel}
                        className="flex flex-1 items-center justify-center rounded border border-border p-1.5 text-muted-foreground hover:bg-secondary/50 disabled:opacity-50"
                      >
                        {updatingPhoto ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      </button>
                    )}
                    {needsGlb && (
                      <button
                        type="button"
                        onClick={() => onAttachGlb(part)}
                        disabled={attachingGlb}
                        title={attachGlbLabel}
                        aria-label={attachGlbLabel}
                        className="flex flex-1 items-center justify-center rounded border border-border p-1.5 text-muted-foreground hover:bg-secondary/50 disabled:opacity-50"
                      >
                        {attachingGlb ? <Loader2 className="h-3 w-3 animate-spin" /> : <Box className="h-3 w-3" />}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
