'use client';

import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { useCategories } from './use-sourcing-app';
import { CategoryCard } from './category-card';
import { ALL_CATEGORIES_ID } from './sourcing-app-client';

export default function SourcingAppHomePage() {
  const router = useRouter();
  const { data: categories, isLoading } = useCategories();

  const totalProductCount = categories?.reduce((sum, c) => sum + c.productCount, 0) ?? 0;

  return (
    <div className="space-y-2 p-3">
      {isLoading ? (
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
      )}
    </div>
  );
}
