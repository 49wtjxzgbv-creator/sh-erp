'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Loader2, Plus } from 'lucide-react';
import { analyzeGlbParts, type GlbPartAnalysis } from '@/components/domain/files/step-3d-viewer';
import { useAssemblyBomArticles, useAssemblyBomActions } from '@/lib/hooks/use-bom';
import { useCreateProductFromPart } from '@/components/domain/bom/use-create-product-from-part';
import { CreateProductDialog } from '@/components/domain/catalog/create-product-dialog';
import { queryProducts, type Product } from '@/lib/api-client/catalog';
import { cn } from '@/lib/utils';

interface ResolvedPart extends GlbPartAnalysis {
  product: Product | null;
}

/** Runs `fn` over `items` with at most `limit` in flight at once — a plain `Promise.all` over every distinct part in the model would fire dozens of catalog lookups at the same instant the moment this tab opens (not a deliberate user click, unlike the tree's own "Додати все"), so this keeps that burst bounded. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function resolveAgainstCatalog(parts: GlbPartAnalysis[]): Promise<ResolvedPart[]> {
  return mapWithConcurrency(parts, 5, async (part) => {
    const matches = await queryProducts({ search: part.article, limit: 20 });
    const product = matches.items.find((p) => p.article.trim().toUpperCase() === part.article.trim().toUpperCase()) ?? null;
    return { ...part, product };
  });
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

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    (async () => {
      try {
        const analyzed = await analyzeGlbParts(glbUrl);
        if (cancelled) return;
        const resolved = await resolveAgainstCatalog(analyzed);
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
    };
  }, [glbUrl]);

  const { bomArticles } = useAssemblyBomArticles(assemblyId);
  const bomSet = new Set(bomArticles.map((a) => a.trim().toUpperCase()));
  const { appendProductLines } = useAssemblyBomActions(assemblyId);
  const { requestCreate, dialogProps } = useCreateProductFromPart(appendProductLines);
  const [pendingArticles, setPendingArticles] = useState<Set<string>>(new Set());

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

  const inCatalog = parts.filter((p) => p.product);
  const notInCatalog = parts.filter((p) => !p.product);

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
            readOnly={readOnly}
            onAdd={handleAdd}
            addLabel={t('partsCheckAdd')}
            addedLabel={t('partsCheckAdded')}
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
                  {part.qty > 1 && <p className="text-xs text-muted-foreground">×{part.qty}</p>}
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => requestCreate(part.article, part.name, part.qty, part.photoDataUrl, null)}
                    className="rounded border border-border px-2 py-1 text-xs font-medium hover:bg-secondary/50"
                  >
                    {tf('createProduct')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <CreateProductDialog {...dialogProps} />
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
  readOnly,
  onAdd,
  addLabel,
  addedLabel,
}: {
  parts: ResolvedPart[];
  bomSet: Set<string>;
  pendingArticles: Set<string>;
  readOnly?: boolean;
  onAdd: (part: ResolvedPart) => void;
  addLabel: string;
  addedLabel: string;
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {parts.map((part) => {
        const inBom = part.product ? bomSet.has(part.product.article.trim().toUpperCase()) : false;
        const pending = pendingArticles.has(part.article);
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
              {part.qty > 1 && <p className="text-xs text-muted-foreground">×{part.qty}</p>}
            </div>
            {!readOnly && (
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
            )}
          </li>
        );
      })}
    </ul>
  );
}
