import * as React from 'react';
import { cn } from '@/lib/utils';

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    // `max-h` + `overflow-auto` makes this div its OWN bounded scrollport —
    // required for TableHeader's `sticky top-0` to have anything to stick
    // against. Delegating vertical scroll up to the page (`overflow-x-auto`
    // only, no `max-h`) does not work: per the CSS Overflow spec, setting
    // overflow-x to anything other than `visible` forces the computed value
    // of overflow-y to `auto` too if it isn't already `visible` — the two
    // axes can't be split apart — so the div silently becomes an unbounded
    // (grows-to-content) scroll container either way, and sticky has no
    // real scrollport to pin against. Same bounded-height + internal-scroll
    // convention already used for the Planner board (`max-h-[75vh]`).
    <div className="w-full max-h-[70vh] overflow-auto rounded-md border border-border">
      <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  ),
);
Table.displayName = 'Table';

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead ref={ref} className={cn('sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]', className)} {...props} />
  ),
);
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />,
);
TableBody.displayName = 'TableBody';

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn('border-b border-border/70 transition-colors hover:bg-secondary/50', className)}
      {...props}
    />
  ),
);
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }
>(({ className, numeric, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-10 whitespace-nowrap px-3 text-left align-middle text-xs font-medium text-muted-foreground',
      numeric && 'text-right tabular-nums',
      className,
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }
>(({ className, numeric, ...props }, ref) => (
  <td
    ref={ref}
    className={cn('whitespace-nowrap px-3 py-2.5 align-middle', numeric && 'text-right tabular-nums', className)}
    {...props}
  />
));
TableCell.displayName = 'TableCell';

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
