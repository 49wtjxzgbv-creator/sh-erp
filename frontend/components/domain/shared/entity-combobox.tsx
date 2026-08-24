'use client';

import { useEffect, useRef, useState } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Shared typeahead primitive behind all five entity pickers (product/
 * assembly/customer-order/supplier/employee) — P0 fix (2026-08-20).
 *
 * Root cause of the click bug this replaces: each picker used to render its
 * own absolutely-positioned (`position: absolute; top: 100%`) result list.
 * `components/ui/table.tsx` wraps every `<table>` in a
 * `max-h-[70vh] overflow-auto` div for its sticky-header feature — when a
 * picker's dropdown was rendered inside a `<TableCell>`, it became a
 * descendant of that clipping div, and the clipping applied to
 * `elementFromPoint()` hit-testing, not just paint. A real click at the
 * dropdown's visible coordinates resolved to whatever was underneath
 * instead of the option — not a focus/blur race (that was already handled
 * correctly via `onMouseDown` + `preventDefault()` below, unchanged), a
 * genuine clipping bug. Built on `@radix-ui/react-popover` (already an
 * installed dependency), which portals its content to `document.body` —
 * this escapes ANY ancestor `overflow`/`z-index` clipping by construction,
 * the same mechanism Radix's own `Select` uses.
 *
 * Each concrete picker keeps its own data-fetching hook and hydration
 * logic (they differ too much — avatars, different entity shapes — to be
 * worth folding in here); this owns only the shared shell: input +
 * portaled list + keyboard navigation (Arrow/Enter/Escape — previously
 * absent from every picker) + the mouse-safe select-before-blur pattern.
 */
export interface EntityComboboxProps<T> {
  query: string;
  onQueryChange: (query: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: T[];
  getKey: (item: T) => string;
  isSelected?: (item: T) => boolean;
  onSelect: (item: T) => void;
  /** Inner content only (no outer button/interactive classes needed — EntityCombobox owns those). */
  renderItem: (item: T) => React.ReactNode;
  placeholder?: string;
  emptyLabel?: string;
  /** e.g. an Avatar shown before the input for the currently selected value. */
  leading?: React.ReactNode;
  inputClassName?: string;
  containerClassName?: string;
  /** Optional row rendered below the item list (e.g. a "+ create new" action) — opt-in only, no effect on callers that omit it. */
  footer?: React.ReactNode;
}

export function EntityCombobox<T>({
  query,
  onQueryChange,
  open,
  onOpenChange,
  items,
  getKey,
  isSelected,
  onSelect,
  renderItem,
  placeholder,
  emptyLabel = '—',
  leading,
  inputClassName,
  containerClassName,
  footer,
}: EntityComboboxProps<T>) {
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // New search results (or a fresh open) should highlight the top result,
  // not whatever index the previous list happened to leave selected.
  useEffect(() => {
    setHighlightedIndex(0);
  }, [items, open]);

  useEffect(() => {
    itemRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        onOpenChange(true);
        return;
      }
      setHighlightedIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return;
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (!open) return;
      const item = items[highlightedIndex];
      if (item) {
        e.preventDefault();
        onSelect(item);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        onOpenChange(false);
      }
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <div className={cn('relative flex items-center gap-2', containerClassName)}>
          {leading}
          <Input
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              onQueryChange(e.target.value);
              onOpenChange(true);
            }}
            onFocus={() => onOpenChange(true)}
            onBlur={() => setTimeout(() => onOpenChange(false), 100)}
            onKeyDown={handleKeyDown}
            className={inputClassName}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-[var(--radix-popover-trigger-width)] max-h-64 overflow-auto rounded-md border border-border bg-popover p-0 text-sm shadow-md"
      >
        {items.length ? (
          items.map((item, index) => (
            <button
              key={getKey(item)}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(item);
              }}
              onMouseEnter={() => setHighlightedIndex(index)}
              className={cn(
                'block w-full px-3 py-2 text-left text-sm hover:bg-secondary',
                (index === highlightedIndex || isSelected?.(item)) && 'bg-secondary',
              )}
            >
              {renderItem(item)}
            </button>
          ))
        ) : (
          <div className="px-3 py-2 text-sm text-muted-foreground">{emptyLabel}</div>
        )}
        {footer}
      </PopoverContent>
    </Popover>
  );
}
