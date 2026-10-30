'use client';

import type { LoadPlanPlacedBox } from '@/lib/api-client/sales';
import { colorForAssembly } from './truck-load-viewer';

export interface LoadPlan2DViewProps {
  truckDims: { lengthCm: number; widthCm: number; heightCm: number };
  placedBoxes: LoadPlanPlacedBox[];
  /** Short label per box, by its (synthetic-or-real) assemblyId — same map the page already builds for the 3D legend. */
  namesByAssemblyId: Map<string, string>;
  /** `top` = looking straight down (length × width) — matches how a worker actually walks the truck. `side` = looking in from the open end (length × height) — shows the stacking. */
  view: 'top' | 'side';
  className?: string;
}

/**
 * Flat 2D schematic (2026-10-30, "потрібно додати якусь ще карту
 * завантаження... інструкцію") — a printable top-down/side map alongside
 * the existing 3D view, same `placedBoxes` the 3D viewer already gets, no
 * backend changes. Plain SVG rather than a charting library — no
 * recharts/d3 dependency exists anywhere else in this codebase (see
 * planner-gantt-print.tsx's own hand-built `MiniBar` for the established
 * precedent of rolling a small diagram by hand instead).
 */
export function LoadPlan2DView({ truckDims, placedBoxes, namesByAssemblyId, view, className }: LoadPlan2DViewProps) {
  const crossAxisCm = view === 'top' ? truckDims.widthCm : truckDims.heightCm;
  const crossOf = (b: LoadPlanPlacedBox) => (view === 'top' ? b.y : b.z);
  const crossSizeOf = (b: LoadPlanPlacedBox) => (view === 'top' ? b.widthCm : b.heightCm);

  return (
    <svg
      viewBox={`0 0 ${truckDims.lengthCm} ${crossAxisCm}`}
      className={className}
      style={{ width: '100%', height: 'auto', background: 'var(--card, #fff)' }}
      role="img"
    >
      <rect x={0} y={0} width={truckDims.lengthCm} height={crossAxisCm} fill="none" stroke="currentColor" strokeWidth={Math.max(truckDims.lengthCm, crossAxisCm) * 0.004} />
      {placedBoxes.map((box, i) => {
        const label = namesByAssemblyId.get(box.assemblyId) ?? '';
        const fontSize = Math.min(box.lengthCm, crossSizeOf(box)) * 0.28;
        return (
          <g key={`${box.assemblyId}-${i}`}>
            <rect
              x={box.x}
              y={crossOf(box)}
              width={box.lengthCm}
              height={crossSizeOf(box)}
              fill={colorForAssembly(box.assemblyId)}
              fillOpacity={0.75}
              stroke="currentColor"
              strokeWidth={Math.max(truckDims.lengthCm, crossAxisCm) * 0.0015}
            />
            {label && fontSize > 3 && (
              <text
                x={box.x + box.lengthCm / 2}
                y={crossOf(box) + crossSizeOf(box) / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={fontSize}
                fill="#1e293b"
                style={{ pointerEvents: 'none' }}
              >
                {label.length > 14 ? `${label.slice(0, 13)}…` : label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
