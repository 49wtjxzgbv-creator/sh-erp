'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { useGlobalSearch } from '@/lib/hooks/use-search';
import type { SearchResultItem } from '@/lib/api-client/search';
import { cn } from '@/lib/utils';

const GROUPS: { key: 'products' | 'assemblies' | 'customerOrders' | 'suppliers'; labelKey: string }[] = [
  { key: 'products', labelKey: 'products' },
  { key: 'assemblies', labelKey: 'assemblies' },
  { key: 'customerOrders', labelKey: 'customerOrders' },
  { key: 'suppliers', labelKey: 'suppliers' },
];

/**
 * Instant search dropdown — debounces locally (300ms) before hitting
 * GET /search, which itself mirrors each module's own list-page `search`
 * filter (see backend/src/modules/search/search.service.ts). No keyboard
 * shortcut/command-palette framing on purpose: this is a plain "type,
 * see matches, click one" affordance, not a power-user command runner.
 */
export function GlobalSearch({ className }: { className?: string }) {
  const t = useTranslations('search');
  const tc = useTranslations('common');
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isFetching } = useGlobalSearch(debouncedQuery);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function go(item: SearchResultItem) {
    setOpen(false);
    setQuery('');
    router.push(item.href);
  }

  const hasAnyResults = data ? GROUPS.some((g) => data[g.key].length > 0) : false;
  const showDropdown = open && query.trim().length > 0;

  return (
    <div ref={containerRef} className={cn('relative w-full max-w-sm', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        placeholder={t('placeholder')}
        className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />

      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-96 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
          {query.trim().length < 2 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">{t('typeToSearch')}</p>
          ) : isFetching && !data ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">{tc('loading')}</p>
          ) : !hasAnyResults ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">{t('noResults')}</p>
          ) : (
            GROUPS.map(({ key, labelKey }) => {
              const items = data?.[key] ?? [];
              if (items.length === 0) return null;
              return (
                <div key={key} className="border-b border-border py-1 last:border-b-0">
                  <p className="px-3 py-1 text-xs font-medium uppercase text-muted-foreground">{t(labelKey)}</p>
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => go(item)}
                      className="flex w-full flex-col items-start px-3 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <span className="truncate">{item.label}</span>
                      {item.sublabel && <span className="truncate text-xs text-muted-foreground">{item.sublabel}</span>}
                    </button>
                  ))}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
