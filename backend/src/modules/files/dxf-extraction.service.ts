import { Injectable } from '@nestjs/common';
import { Parser as DxfParser } from '@dxfjs/parser';
import type { ArcEntity, CircleEntity, Entities, LWPolylineEntity, LineEntity, PolylineEntity } from '@dxfjs/parser';
import type { StepBomLine } from './step-conversion.service';

/**
 * DXF shape extraction for розкрій (2026-11-01) — a hand-typed material's
 * "Завантажити STEP" button on the cutting module also accepts a plain 2D
 * DXF drawing now (see cad-shape-extraction.service.ts for the dispatch).
 * Deliberately NOT wired into the BOM "Креслення → специфікація" page
 * (step-bom-extraction.service.ts): a DXF file is a flat 2D drawing with no
 * assembly tree / part-quantity structure the way a STEP assembly has, so
 * it only makes sense as a cut-shape source, not a multi-part BOM source.
 *
 * Unlike STEP (a 3D B-rep needing OCCT/WASM tessellation in a spawned child
 * process — see step-conversion.service.ts's own header comment for the
 * real memory/timeout incidents that drove that), a DXF file is already a
 * flat 2D vector drawing: no 3D solid to tessellate, no child process, no
 * temp files. Pure, synchronous, in-process JS geometry.
 *
 * Output reuses `StepBomLine` (defined for the STEP path) verbatim — same
 * {name, qty, dimensionsCm, lengthCm, widthCm, heightCm, shapeKind,
 * outerCm, holesCm} shape, so CadShapeExtractionService can run EITHER
 * source through the exact same toMatchedBomLine() catalog-matching step
 * with zero branching beyond "which extractor produced this StepBomLine[]".
 */

// DXF files are conventionally authored in millimeters (same assumption
// step-extract-bom-child.js's own computeBoundingBoxCm already documents
// for STEP) — honored via $INSUNITS when the parser actually exposes a
// recognized value (4 = mm, 1 = inch), defaulting to mm otherwise. Labeled
// as a geometry-derived approximation in dimensionsCm, same as STEP.
function unitsScaleToCm(header: Record<string, unknown> | undefined): number {
  const insunits = header?.['$INSUNITS'];
  if (insunits === 1) return 2.54; // inches -> cm
  if (insunits === 4) return 0.1; // mm -> cm
  return 0.1; // undocumented/0 — assume mm, same default STEP already makes
}

const ARC_STEP_DEG = 6; // coarse is fine — this is a cut-piece outline, not a render mesh (same reasoning step-extract-bom-child.js's own TESSELLATION_PARAMS comment gives for STEP)
const ENDPOINT_TOLERANCE_CM = 0.02; // chaining/closing tolerance — real CAM/CAD DXF exports have exactly-matching endpoints, this just absorbs floating-point noise

export type Point2D = [number, number];

function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function tessellateArcPoints(cx: number, cy: number, r: number, startDeg: number, endDeg: number): Point2D[] {
  let sweep = endDeg - startDeg;
  if (sweep <= 0) sweep += 360;
  const steps = Math.max(2, Math.ceil(sweep / ARC_STEP_DEG));
  const points: Point2D[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((startDeg + (sweep * i) / steps) * Math.PI) / 180;
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return points;
}

/**
 * DXF "bulge" (group code 42) tessellation — standard, documented
 * convention: bulge = tan(θ/4), θ the arc's own included angle, sign
 * positive = counterclockwise from p1 to p2. Returns the intermediate
 * points strictly BETWEEN p1 and p2 (exclusive of both endpoints) — the
 * caller already has p1/p2 themselves from the polyline's own vertex list.
 */
export function tessellateBulge(p1: Point2D, p2: Point2D, bulge: number): Point2D[] {
  if (bulge === 0) return [];
  const theta = 4 * Math.atan(bulge);
  const chordDx = p2[0] - p1[0];
  const chordDy = p2[1] - p1[1];
  const chordLen = Math.hypot(chordDx, chordDy);
  if (chordLen < 1e-9) return [];
  const radius = chordLen / (2 * Math.sin(theta / 2));
  const mx = (p1[0] + p2[0]) / 2;
  const my = (p1[1] + p2[1]) / 2;
  // Unit vector perpendicular to the chord (rotate chord direction +90°) —
  // the center always sits on this line through the chord midpoint.
  const ux = -chordDy / chordLen;
  const uy = chordDx / chordLen;
  const apothem = radius * Math.cos(theta / 2); // signed distance from chord midpoint to center
  const cx = mx + ux * apothem;
  const cy = my + uy * apothem;
  const r = Math.abs(radius);
  const startAngle = Math.atan2(p1[1] - cy, p1[0] - cx);
  const steps = Math.max(2, Math.ceil((Math.abs(theta) * (180 / Math.PI)) / ARC_STEP_DEG));
  const points: Point2D[] = [];
  for (let i = 1; i < steps; i++) {
    const a = startAngle + (theta * i) / steps;
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return points;
}

interface OpenPath {
  points: Point2D[]; // already tessellated, in cm
  closed: boolean; // entity's own closed flag (LWPOLYLINE/POLYLINE) — true also forces loop closure regardless of endpoint distance
}

function lwPolylineToPath(entity: LWPolylineEntity, scale: number): OpenPath {
  const verts = entity.vertices.map((v): Point2D => [v.x * scale, v.y * scale]);
  const closed = (entity.flag & 1) !== 0;
  const points: Point2D[] = [];
  const n = verts.length;
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const p1 = verts[i];
    const p2 = verts[(i + 1) % n];
    const bulge = entity.vertices[i].bulge;
    points.push(p1);
    if (bulge) points.push(...tessellateBulge(p1, p2, bulge));
  }
  if (!closed) points.push(verts[n - 1]);
  return { points, closed };
}

function polylineToPath(entity: PolylineEntity, scale: number): OpenPath {
  const verts = entity.vertices.map((v): Point2D => [v.x * scale, v.y * scale]);
  const closed = (entity.flag & 1) !== 0;
  const points: Point2D[] = [];
  const n = verts.length;
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const p1 = verts[i];
    const p2 = verts[(i + 1) % n];
    const bulge = entity.vertices[i].bulge;
    points.push(p1);
    if (bulge) points.push(...tessellateBulge(p1, p2, bulge));
  }
  if (!closed) points.push(verts[n - 1]);
  return { points, closed };
}

function lineToPath(entity: LineEntity, scale: number): OpenPath {
  return { points: [[entity.startX * scale, entity.startY * scale] as Point2D, [entity.endX * scale, entity.endY * scale] as Point2D], closed: false };
}

function arcToPath(entity: ArcEntity, scale: number): OpenPath {
  const points = tessellateArcPoints(entity.centerX * scale, entity.centerY * scale, entity.radius * scale, entity.startAngle, entity.endAngle);
  return { points, closed: false };
}

function circleToPath(entity: CircleEntity, scale: number): OpenPath {
  const points = tessellateArcPoints(entity.centerX * scale, entity.centerY * scale, entity.radius * scale, 0, 360);
  return { points, closed: true };
}

/**
 * Chains open (LINE/ARC, and any not-explicitly-closed LWPOLYLINE/POLYLINE)
 * paths into closed loops by matching endpoints within tolerance — a
 * simplified 2D version of the same "chain boundary segments into closed
 * loops" problem step-extract-bom-child.js already solves for STEP's
 * mesh-boundary edges (see that file's header comment). Real CAM/CAD DXF
 * exports already have exactly-matching endpoints, so a simple greedy
 * nearest-endpoint walk is enough — no fuzzy topology repair attempted.
 * Paths that never close are dropped (a dangling line contributes no cut
 * shape) rather than guessed into a loop.
 */
export function chainIntoClosedLoops(openPaths: Point2D[][]): Point2D[][] {
  const remaining = openPaths.map((p) => [...p]);
  const loops: Point2D[][] = [];

  while (remaining.length > 0) {
    let chain = remaining.shift()!;
    let extended = true;
    while (extended) {
      extended = false;
      const head = chain[0];
      const tail = chain[chain.length - 1];
      if (dist(head, tail) <= ENDPOINT_TOLERANCE_CM && chain.length > 2) break; // already closed
      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i];
        const cHead = candidate[0];
        const cTail = candidate[candidate.length - 1];
        if (dist(tail, cHead) <= ENDPOINT_TOLERANCE_CM) {
          chain = chain.concat(candidate.slice(1));
          remaining.splice(i, 1);
          extended = true;
          break;
        }
        if (dist(tail, cTail) <= ENDPOINT_TOLERANCE_CM) {
          chain = chain.concat([...candidate].reverse().slice(1));
          remaining.splice(i, 1);
          extended = true;
          break;
        }
      }
    }
    if (dist(chain[0], chain[chain.length - 1]) <= ENDPOINT_TOLERANCE_CM && chain.length >= 3) {
      loops.push(chain);
    }
    // Paths that never close (a dangling/unconnected line or arc) are
    // silently dropped — no cut shape can be formed from an open path.
  }
  return loops;
}

function shoelaceArea(loop: Point2D[]): number {
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x1, y1] = loop[i];
    const [x2, y2] = loop[(i + 1) % loop.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** Standard ray-casting point-in-polygon test. */
function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export interface ShapeGroup {
  outer: Point2D[];
  holes: Point2D[][];
}

/**
 * Groups closed loops into outer-shape + holes — same "largest loop is the
 * outer contour, smaller loops nested inside it are holes" rule
 * step-extract-bom-child.js's own header comment documents for STEP faces.
 * A loop with no containing parent is its own separate outer shape, so a
 * DXF "nest" file holding several unconnected parts naturally produces
 * several groups. A contained loop is assigned to its SMALLEST containing
 * loop (handles one level of island-inside-a-hole correctly).
 */
export function classifyLoops(loops: Point2D[][]): ShapeGroup[] {
  const withArea = loops.map((loop) => ({ loop, area: Math.abs(shoelaceArea(loop)) })).filter((l) => l.area > 1e-6);
  withArea.sort((a, b) => b.area - a.area);

  const groups: ShapeGroup[] = [];
  const containerIndex = new Map<number, number>(); // loop index -> index into `groups` it's a hole of

  for (let i = 0; i < withArea.length; i++) {
    const { loop } = withArea[i];
    let bestContainer: number | null = null;
    let bestArea = Infinity;
    for (let j = 0; j < withArea.length; j++) {
      if (i === j) continue;
      if (withArea[j].area <= withArea[i].area) continue;
      if (pointInPolygon(loop[0], withArea[j].loop) && withArea[j].area < bestArea) {
        bestContainer = j;
        bestArea = withArea[j].area;
      }
    }
    if (bestContainer === null) {
      containerIndex.set(i, groups.length);
      groups.push({ outer: loop, holes: [] });
    } else {
      const groupIdx = containerIndex.get(bestContainer);
      if (groupIdx !== undefined) groups[groupIdx].holes.push(loop);
    }
  }
  return groups;
}

function boundingBoxCm(loop: Point2D[]): { lengthCm: number; widthCm: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of loop) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return { lengthCm: round1(maxX - minX), widthCm: round1(maxY - minY) };
}

@Injectable()
export class DxfExtractionService {
  isDxfFile(originalName: string): boolean {
    return /\.dxf$/i.test(originalName);
  }

  /** Parses raw DXF text bytes into grouped cut-shape lines — see this file's own header comment for the overall approach. Never throws on a geometrically-empty file (zero shapes); the caller decides whether that's an error. */
  async extractShapesFromDxf(fileBytes: Buffer, baseName: string): Promise<StepBomLine[]> {
    const content = fileBytes.toString('utf8');
    const dxf = await new DxfParser().parse(content);
    const entities: Entities = dxf.entities;
    const scale = unitsScaleToCm(dxf.header as unknown as Record<string, unknown>);

    const closedLoops: Point2D[][] = [];
    const openPaths: Point2D[][] = [];

    for (const circle of entities.circles ?? []) closedLoops.push(circleToPath(circle, scale).points);

    for (const lw of entities.lwPolylines ?? []) {
      const path = lwPolylineToPath(lw, scale);
      (path.closed ? closedLoops : openPaths).push(path.points);
    }
    for (const pl of entities.polylines ?? []) {
      const path = polylineToPath(pl, scale);
      (path.closed ? closedLoops : openPaths).push(path.points);
    }
    for (const line of entities.lines ?? []) openPaths.push(lineToPath(line, scale).points);
    for (const arc of entities.arcs ?? []) openPaths.push(arcToPath(arc, scale).points);
    // SPLINE entities are not tessellated (real NURBS evaluation, rare in
    // laser/plasma cut-profile exports) — a file containing only splines
    // simply yields zero loops below, same honest "no shapes found" outcome
    // as an empty file, not a silently wrong shape.

    const chained = chainIntoClosedLoops(openPaths);
    const groups = classifyLoops([...closedLoops, ...chained]);

    const named = groups.length <= 1;
    return groups.map((group, i) => {
      const { lengthCm, widthCm } = boundingBoxCm(group.outer);
      return {
        name: named ? baseName : `${baseName} — деталь ${i + 1}`,
        qty: 1,
        dimensionsCm: `${lengthCm}×${widthCm} см (за геометрією)`,
        lengthCm,
        widthCm,
        heightCm: null,
        shapeKind: 'polygon',
        outerCm: group.outer,
        holesCm: group.holes,
      };
    });
  }
}
