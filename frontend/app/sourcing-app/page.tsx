'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { useCategories, useAssemblies } from './use-sourcing-app';
import { CategoryCard } from './category-card';
import { AssemblyCard } from './assembly-card';
import { SegmentButton } from './pill-controls';
import { ALL_CATEGORIES_ID } from './sourcing-app-client';

type Mode = 'categories' | 'assemblies';

export default function SourcingAppHomePage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // "коли... натискаємо повернутись назад то має повертатися у попереднє
  // меню а не на головне" (2026-11-10) — the Категорії/Виробами toggle is
  // reflected in the URL (not just component state) specifically so that
  // the category/assembly detail pages' back-button (`router.back()`)
  // actually lands back on whichever tab the user came from, not always
  // the default one.
  const mode: Mode = searchParams.get('mode') === 'assemblies' ? 'assemblies' : 'categories';
  const { data: categories, isLoading: loadingCategories } = useCategories();
  const { data: assemblies, isLoading: loadingAssemblies } = useAssemblies();

  const totalProductCount = categories?.reduce((sum, c) => sum + c.productCount, 0) ?? 0;

  function setMode(next: Mode) {
    router.replace(next === 'categories' ? pathname : `${pathname}?mode=${next}`, { scroll: false });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex gap-2 p-3" style={{ background: 'var(--tg-bg)' }}>
        {/* "пошук товарів не по категоріям а по виробах" (2026-11-10) — a segmented toggle rather than a 5th bottom tab, same pattern the Постачальники tab already uses for Наші/Можливі. */}
        <SegmentButton active={mode === 'categories'} onClick={() => setMode('categories')}>📂 Категорії</SegmentButton>
        <SegmentButton active={mode === 'assemblies'} onClick={() => setMode('assemblies')}>🏭 Виробами</SegmentButton>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3 pt-0">
        {mode === 'categories' ? (
          loadingCategories ? (
            <>
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
            </>
          ) : !categories || categories.length === 0 ? (
            <p className="p-4 text-center text-sm" style={{ color: 'var(--tg-hint)' }}>Поки немає жодної категорії.</p>
          ) : (
            <>
              {/* "в категоріях має бути категорія всі щоб просто гортати всі товари" (2026-11-10) — a synthetic entry, not a real SourcingCategory, so it's prepended here rather than coming back from the categories endpoint. */}
              <CategoryCard
                category={{ id: ALL_CATEGORIES_ID, code: 'ALL', name: '📚 Всі товари', productCount: totalProductCount }}
                onClick={() => router.push(`/sourcing-app/categories/${ALL_CATEGORIES_ID}`)}
              />
              {categories.map((category) => (
                <CategoryCard key={category.id} category={category} onClick={() => router.push(`/sourcing-app/categories/${category.id}`)} />
              ))}
            </>
          )
        ) : loadingAssemblies ? (
          <>
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </>
        ) : !assemblies || assemblies.length === 0 ? (
          <p className="p-4 text-center text-sm" style={{ color: 'var(--tg-hint)' }}>Поки немає жодного виробу.</p>
        ) : (
          assemblies.map((assembly) => (
            <AssemblyCard key={assembly.id} assembly={assembly} onClick={() => router.push(`/sourcing-app/assemblies/${assembly.id}`)} />
          ))
        )}
      </div>
    </div>
  );
}
