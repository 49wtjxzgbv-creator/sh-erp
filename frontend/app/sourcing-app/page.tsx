'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useCategories, useAssemblies } from './use-sourcing-app';
import { CategoryCard } from './category-card';
import { AssemblyCard } from './assembly-card';
import { ALL_CATEGORIES_ID } from './sourcing-app-client';

type Mode = 'categories' | 'assemblies';

export default function SourcingAppHomePage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('categories');
  const { data: categories, isLoading: loadingCategories } = useCategories();
  const { data: assemblies, isLoading: loadingAssemblies } = useAssemblies();

  const totalProductCount = categories?.reduce((sum, c) => sum + c.productCount, 0) ?? 0;

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

function SegmentButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('flex-1 rounded-lg py-2 text-sm font-medium transition-colors')}
      style={active ? { background: 'var(--tg-button)', color: 'var(--tg-button-text)' } : { background: 'var(--tg-secondary-bg)', color: 'var(--tg-text)' }}
    >
      {children}
    </button>
  );
}
