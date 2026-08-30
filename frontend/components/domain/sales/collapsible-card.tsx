'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Collapsed-by-default Card (2026-08-27 user request, Sales order page —
 * the payroll fund and production progress blocks were pushing the items
 * table too far down the page). Click the header to toggle; no persistence
 * across reloads. Extracted (2026-08-30) so PayrollFundWidget/
 * FinanceSummaryWidget can be reused outside sales/[id] (План виробництва
 * order detail's own "Фінанси"/"Зарплата" tabs) — `defaultOpen` lets a
 * standalone-tab caller start expanded instead of collapsed.
 */
export function CollapsibleCard({
  title,
  headerExtra,
  contentClassName,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** Rendered between the title and the chevron — caller must stopPropagation on its own interactive children, since the whole header toggles the card on click. */
  headerExtra?: React.ReactNode;
  contentClassName?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <CardHeader
        className="flex cursor-pointer select-none flex-row items-center justify-between space-y-0"
        onClick={() => setOpen((o) => !o)}
      >
        <CardTitle className="text-base">{title}</CardTitle>
        <div className="flex items-center gap-2">
          {headerExtra}
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </div>
      </CardHeader>
      {open && <CardContent className={contentClassName}>{children}</CardContent>}
    </Card>
  );
}
