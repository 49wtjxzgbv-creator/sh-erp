'use client';

import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { useCategories } from './use-sourcing-app';
import { CategoryCard } from './category-card';

export default function SourcingAppHomePage() {
  const router = useRouter();
  const { data: categories, isLoading } = useCategories();

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
        categories.map((category) => (
          <CategoryCard key={category.id} category={category} onClick={() => router.push(`/sourcing-app/categories/${category.id}`)} />
        ))
      )}
    </div>
  );
}
