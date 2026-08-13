'use client';

import { Info } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

export interface HelpHintProps {
  /** Short label for the field/control this explains, e.g. "Планове завершення". */
  title: string;
  /** Plain-language explanation — what it means, what it's for. Not technical documentation. */
  children: React.ReactNode;
  /** Optional trailing note, shown with a small ℹ prefix — e.g. "Можна змінити пізніше." */
  note?: string;
  className?: string;
}

/**
 * Compact contextual-help affordance for complex fields/controls across the
 * app — a small `?`/`ⓘ` icon that opens a short popover on click, never a
 * modal. Deliberately terse: one field, one plain-language explanation, no
 * technical documentation tone.
 */
export function HelpHint({ title, children, note, className }: HelpHintProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Довідка: ${title}`}
          className={
            className ??
            'inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground'
          }
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-1.5">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-muted-foreground">{children}</p>
        {note && (
          <p className="flex items-start gap-1 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{note}</span>
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
