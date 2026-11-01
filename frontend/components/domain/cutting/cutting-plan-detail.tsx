'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Scissors } from 'lucide-react';
import { useCuttingPlan, useExecuteCuttingPlan } from '@/lib/hooks/use-cutting';
import { useHasPermission } from '@/lib/hooks/use-roles';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { toNumber } from '@/lib/api-client/decimal';
import type { CuttingPlanMaterial, CuttingPlanStock } from '@/lib/api-client/cutting';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingBlock } from '@/components/ui/loading-block';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';

// Two parallel literal arrays (not derived from one another via string
// replace) — Tailwind's JIT content scanner only picks up class names that
// appear as complete literal strings in the source, so a runtime
// `.replace('bg-', 'fill-')` would silently produce an unstyled SVG in a
// production build.
const SEGMENT_BG_COLORS = ['bg-primary/70', 'bg-sky-500/70', 'bg-emerald-500/70', 'bg-amber-500/70', 'bg-fuchsia-500/70', 'bg-rose-500/70'];
const SEGMENT_FILL_COLORS = ['fill-primary/70', 'fill-sky-500/70', 'fill-emerald-500/70', 'fill-amber-500/70', 'fill-fuchsia-500/70', 'fill-rose-500/70'];

/** One штанга's cut map — proportional flex segments, one per cut plus the leftover. */
function BarStockDiagram({ stockItem }: { stockItem: CuttingPlanStock }) {
  const totalCm = toNumber(stockItem.lengthCm) ?? 0;
  if (totalCm <= 0) return null;
  const leftoverCm = toNumber(stockItem.leftoverLengthCm) ?? 0;

  return (
    <div className="flex h-8 w-full overflow-hidden rounded border border-border">
      {stockItem.cuts.map((cut, i) => {
        const lengthCm = toNumber(cut.pieceLengthCm) ?? 0;
        return (
          <div
            key={cut.id}
            className={`flex items-center justify-center overflow-hidden whitespace-nowrap text-[10px] text-white ${SEGMENT_BG_COLORS[i % SEGMENT_BG_COLORS.length]}`}
            style={{ flex: `${lengthCm} 0 0%` }}
            title={`${lengthCm} см`}
          >
            {lengthCm} см
          </div>
        );
      })}
      {leftoverCm > 0 && (
        <div
          className="flex items-center justify-center overflow-hidden whitespace-nowrap bg-muted text-[10px] text-muted-foreground"
          style={{ flex: `${leftoverCm} 0 0%` }}
          title={`${leftoverCm} см`}
        >
          {leftoverCm} см
        </div>
      )}
    </div>
  );
}

/** Builds an SVG path `d` string for a polygon with holes (even-odd fill rule punches the holes out) — one `M...Z` ring per outer/hole loop. */
function polygonToPathD(outerCm: [number, number][], holesCm: [number, number][][]): string {
  const ring = (pts: [number, number][]) => `M ${pts.map(([x, y]) => `${x},${y}`).join(' L ')} Z`;
  return [ring(outerCm), ...holesCm.map(ring)].join(' ');
}

/**
 * One лист's nesting layout. Irregular-shape nesting (2026-11-01): when a
 * cut carries `shapePolygonCm`, draws its real contour (holes punched out
 * via `fill-rule: evenodd`) instead of a bounding-box `<rect>`.
 */
function SheetStockDiagram({ stockItem }: { stockItem: CuttingPlanStock }) {
  const lengthCm = toNumber(stockItem.lengthCm) ?? 0;
  const widthCm = toNumber(stockItem.widthCm) ?? 0;
  if (lengthCm <= 0 || widthCm <= 0) return null;

  return (
    <svg viewBox={`0 0 ${lengthCm} ${widthCm}`} className="w-full rounded border border-border bg-muted" style={{ aspectRatio: `${lengthCm} / ${widthCm}` }}>
      {stockItem.cuts.map((cut, i) =>
        cut.shapePolygonCm ? (
          <path
            key={cut.id}
            d={polygonToPathD(cut.shapePolygonCm.outerCm, cut.shapePolygonCm.holesCm)}
            fillRule="evenodd"
            className={SEGMENT_FILL_COLORS[i % SEGMENT_FILL_COLORS.length]}
            stroke="white"
            strokeWidth={lengthCm / 200}
          />
        ) : (
          <rect
            key={cut.id}
            x={toNumber(cut.posXCm) ?? 0}
            y={toNumber(cut.posYCm) ?? 0}
            width={toNumber(cut.pieceLengthCm) ?? 0}
            height={toNumber(cut.pieceWidthCm) ?? 0}
            className={SEGMENT_FILL_COLORS[i % SEGMENT_FILL_COLORS.length]}
            stroke="white"
            strokeWidth={lengthCm / 200}
          />
        ),
      )}
    </svg>
  );
}

function MaterialCard({ material }: { material: CuttingPlanMaterial }) {
  const t = useTranslations('cutting');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {material.product ? `${material.product.name}${material.product.article ? ` (${material.product.article})` : ''}` : material.productId}
        </CardTitle>
        <CardDescription className="flex flex-wrap gap-x-4">
          <span>{material.kind === 'SHEET' ? t('freshUnitsNeededSheet', { count: material.freshUnitsNeeded }) : t('freshUnitsNeededBar', { count: material.freshUnitsNeeded })}</span>
          {material.remnantsUsed > 0 && <span>{t('remnantsUsedLabel', { count: material.remnantsUsed })}</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {material.stockItems.map((stockItem) => (
          <div key={stockItem.id} className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={stockItem.sourceKind === 'REMNANT' ? 'secondary' : 'outline'}>
                {stockItem.sourceKind === 'REMNANT' ? t('stockItemRemnant') : t('stockItemFresh')}
              </Badge>
            </div>
            {material.kind === 'SHEET' ? <SheetStockDiagram stockItem={stockItem} /> : <BarStockDiagram stockItem={stockItem} />}
            {stockItem.usedAreaCm2 != null && (
              <p className="text-xs text-muted-foreground">
                {t('usedWasteAreaLabel', { used: toNumber(stockItem.usedAreaCm2) ?? 0, waste: toNumber(stockItem.wasteAreaCm2) ?? 0 })}
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export interface CuttingPlanDetailProps {
  planId: string;
}

/**
 * A single CuttingPlan's review/execute page — shared between the
 * assembly-nested route (`/bom/[id]/cutting/[planId]`) and the direct-
 * product top-level route (`/cutting/[planId]`, 2026-11-01). The "back"
 * target branches on the fetched `plan.assemblyId`/`plan.productId` (which
 * origin this specific plan actually came from), not on which route
 * rendered the page — a plan computed directly against a product has no
 * assembly to go back to, and vice versa.
 */
export function CuttingPlanDetail({ planId }: CuttingPlanDetailProps) {
  const router = useRouter();
  const t = useTranslations('cutting');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const { data: plan, isLoading } = useCuttingPlan(planId);
  const execute = useExecuteCuttingPlan(planId);
  const canWrite = useHasPermission('cutting:write');
  const [executeError, setExecuteError] = useState<string | null>(null);

  async function handleExecute() {
    setExecuteError(null);
    try {
      await execute.mutateAsync();
    } catch (err) {
      setExecuteError(apiErrorMessage(err, tc('error')));
    }
  }

  if (isLoading || !plan) return <LoadingBlock />;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{t('planTitle')}</h2>
          <Badge variant={plan.status === 'EXECUTED' ? 'success' : 'outline'}>{plan.status === 'EXECUTED' ? t('planStatusExecuted') : t('planStatusDraft')}</Badge>
        </div>
        {plan.assemblyId ? (
          <Button variant="outline" size="sm" onClick={() => router.push(`/bom/${plan.assemblyId}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('backToAssembly')}
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => router.push('/cutting')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('backToCuttingList')}
          </Button>
        )}
      </div>

      {plan.materials.map((material) => (
        <MaterialCard key={material.productId} material={material} />
      ))}

      {plan.status === 'DRAFT' && canWrite && (
        <Dialog>
          <DialogTrigger asChild>
            <Button loading={execute.isPending}>
              <Scissors className="mr-2 h-4 w-4" />
              {t('executeCuttingPlan')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('executeCuttingPlan')}</DialogTitle>
              <DialogDescription>{t('executeCuttingPlanConfirm')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">{tc('cancel')}</Button>
              </DialogClose>
              <Button loading={execute.isPending} onClick={handleExecute}>
                {t('executeCuttingPlan')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {executeError && <p className="text-sm text-destructive">{executeError}</p>}
    </div>
  );
}
