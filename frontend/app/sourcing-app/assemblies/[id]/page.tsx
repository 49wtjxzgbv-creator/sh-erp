'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PhotoLightbox } from '../../photo-lightbox';
import { useAssembly, useAssemblyProducts, useBulkTranslate, type ProductFilter } from '../../use-sourcing-app';
import { useTelegramBackButton } from '../../use-telegram-back-button';
import { ProductRow } from '../../product-row';
import { ProductSheet } from '../../product-sheet';
import { CandidateSheet } from '../../candidate-sheet';
import { ProductFilterChips } from '../../product-filter-chips';
import { Model3DViewer } from '../../model-3d-viewer';

/** "пошук товарів не по категоріям а по виробах... відкриваємо [специфікацію] і у нас весь список товарів які в неї входять" (2026-11-10) — same list/sheet shape as categories/[id]/page.tsx, just backed by a flattened BOM instead of a sourcing category. */
export default function AssemblyProductsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<ProductFilter>(undefined);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  // "також щоб можна було відкрити фото виробу та 3д модель" (2026-11-25)
  const [showAssemblyPhoto, setShowAssemblyPhoto] = useState(false);
  const [showAssembly3d, setShowAssembly3d] = useState(false);

  // "натискаємо повернутись назад то має повертатися у попереднє меню а не
  // на головне" (2026-11-10) — see categories/[id]/page.tsx's own comment.
  useTelegramBackButton(() => router.back());

  const { data: assembly } = useAssembly(params.id);
  const { data, isLoading } = useAssemblyProducts(params.id, search, page, filter);
  const { translateAll, progress } = useBulkTranslate();

  // Scroll-to-top on page change — see categories/[id]/page.tsx's own comment.
  useEffect(() => {
    document.getElementById('sourcing-app-scroll')?.scrollTo({ top: 0 });
  }, [page]);

  return (
    <div className="flex h-full flex-col">
      {/* "вгорі фото виробу артикул назва і написано що цей виріб складається з таких компонентів" (2026-11-25) — dropping straight into the flat parts list with no context for which виріб this even is. NOT part of the sticky bar below — this scrolls away normally, same as any page header. */}
      {assembly && (
        <div className="flex items-center gap-3 border-b p-4" style={{ borderColor: 'color-mix(in srgb, var(--tg-hint) 15%, transparent)' }}>
          {/* "також щоб можна було відкрити фото виробу та 3д модель" (2026-11-25) — same tap-to-zoom / "🧊 3D" badge pattern as product-sheet.tsx's own photo. */}
          <div className="relative h-16 w-16 shrink-0">
            <button
              type="button"
              onClick={() => assembly.photoUrl && setShowAssemblyPhoto(true)}
              className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg"
              style={{ background: 'var(--tg-secondary-bg)' }}
              disabled={!assembly.photoUrl}
            >
              {assembly.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL
                <img src={assembly.photoUrl} alt={assembly.name} className="h-full w-full object-contain" />
              ) : (
                <span className="text-2xl">🏭</span>
              )}
            </button>
            {assembly.modelUrl && (
              <button
                type="button"
                onClick={() => setShowAssembly3d(true)}
                className="absolute -right-1.5 -top-1.5 flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold shadow-md"
                style={{ background: 'var(--tg-button)', color: 'var(--tg-button-text)' }}
                aria-label="3D"
              >
                🧊
              </button>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{assembly.article ? `${assembly.article} — ` : ''}{assembly.name}</p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--tg-hint)' }}>Цей виріб складається з таких компонентів:</p>
          </div>
        </div>
      )}
      {assembly?.photoUrl && showAssemblyPhoto && (
        <PhotoLightbox src={assembly.photoUrl} alt={assembly.name} onClose={() => setShowAssemblyPhoto(false)} />
      )}
      {assembly?.modelUrl && showAssembly3d && (
        <Model3DViewer src={assembly.modelUrl} onClose={() => setShowAssembly3d(false)} adaptiveFraming />
      )}

      <div className="sticky top-0 z-10" style={{ background: 'var(--tg-bg)' }}>
        <div className="p-3 pb-2">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Пошук за артикулом або назвою…"
          />
        </div>
        <div className="flex items-center gap-2 px-3 pb-2">
          <div className="flex-1 overflow-x-auto">
            <ProductFilterChips value={filter} onChange={(next) => { setFilter(next); setPage(0); }} />
          </div>
          {data && data.items.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              disabled={Boolean(progress)}
              onClick={() => translateAll(data.items.map((p) => p.name))}
            >
              {progress ? `… ${progress.done}/${progress.total}` : '🇺🇦 Перекласти всі'}
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1">
        {isLoading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !data || data.items.length === 0 ? (
          <p className="p-6 text-center text-sm" style={{ color: 'var(--tg-hint)' }}>Нічого не знайдено.</p>
        ) : (
          <>
            {data.items.map((product) => (
              <ProductRow key={product.id} product={product} onClick={() => setSelectedProductId(product.id)} />
            ))}
            {(page > 0 || data.hasMore) && (
              <div className="flex items-center justify-center gap-2 p-3">
                {page > 0 && (
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)}>
                    ⬅️ Попередні
                  </Button>
                )}
                {data.hasMore && (
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)}>
                    Наступні ➡️
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <ProductSheet
        productId={selectedProductId}
        onClose={() => setSelectedProductId(null)}
        onOpenCandidate={(candidateId) => setSelectedCandidateId(candidateId)}
      />
      <CandidateSheet candidateId={selectedCandidateId} onClose={() => setSelectedCandidateId(null)} />
    </div>
  );
}
