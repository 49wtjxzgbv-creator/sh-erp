import { DxfExtractionService, chainIntoClosedLoops, classifyLoops, tessellateBulge, type Point2D } from './dxf-extraction.service';

function dxfEntitiesSection(body: string): string {
  return `0\nSECTION\n2\nENTITIES\n${body}0\nENDSEC\n0\nEOF\n`;
}

function lwPolylineBlock(vertices: [number, number][], closed: boolean): string {
  let s = `0\nLWPOLYLINE\n90\n${vertices.length}\n70\n${closed ? 1 : 0}\n`;
  for (const [x, y] of vertices) s += `10\n${x}\n20\n${y}\n`;
  return s;
}

function lineBlock(x1: number, y1: number, x2: number, y2: number): string {
  return `0\nLINE\n10\n${x1}\n20\n${y1}\n11\n${x2}\n21\n${y2}\n`;
}

function arcBlock(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  return `0\nARC\n10\n${cx}\n20\n${cy}\n40\n${r}\n50\n${startDeg}\n51\n${endDeg}\n`;
}

function circleBlock(cx: number, cy: number, r: number): string {
  return `0\nCIRCLE\n10\n${cx}\n20\n${cy}\n40\n${r}\n`;
}

describe('tessellateBulge', () => {
  it('returns no intermediate points for a straight segment (bulge 0)', () => {
    expect(tessellateBulge([0, 0], [10, 0], 0)).toEqual([]);
  });

  it('bulge of 1 is a perfect semicircle — every tessellated point sits exactly at the chord-midpoint-to-endpoint distance (radius)', () => {
    const p1: Point2D = [0, 0];
    const p2: Point2D = [10, 0];
    const points = tessellateBulge(p1, p2, 1);
    expect(points.length).toBeGreaterThan(5);
    const chordMid: Point2D = [5, 0];
    for (const p of points) {
      const d = Math.hypot(p[0] - chordMid[0], p[1] - chordMid[1]);
      expect(d).toBeCloseTo(5, 5);
    }
  });

  it('a negative bulge arcs the opposite direction from the same positive bulge', () => {
    const positive = tessellateBulge([0, 0], [10, 0], 0.5);
    const negative = tessellateBulge([0, 0], [10, 0], -0.5);
    const midPos = positive[Math.floor(positive.length / 2)];
    const midNeg = negative[Math.floor(negative.length / 2)];
    expect(Math.sign(midPos[1])).not.toBe(Math.sign(midNeg[1]));
  });
});

describe('chainIntoClosedLoops', () => {
  it('chains two open paths sharing endpoints into one closed loop', () => {
    const a: Point2D[] = [
      [0, 0],
      [10, 0],
    ];
    const b: Point2D[] = [
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ];
    const loops = chainIntoClosedLoops([a, b]);
    expect(loops).toHaveLength(1);
    expect(loops[0][0]).toEqual([0, 0]);
  });

  it('drops a path that never closes (a dangling open line)', () => {
    const dangling: Point2D[] = [
      [0, 0],
      [10, 0],
    ];
    const loops = chainIntoClosedLoops([dangling]);
    expect(loops).toHaveLength(0);
  });

  it('chains a reversed-direction segment (tail-to-tail match) correctly', () => {
    const a: Point2D[] = [
      [0, 0],
      [10, 0],
    ];
    const b: Point2D[] = [
      [10, 10],
      [10, 0],
    ]; // shares its OWN tail with a's tail, not its head
    const c: Point2D[] = [
      [0, 10],
      [10, 10],
    ];
    const d: Point2D[] = [
      [0, 0],
      [0, 10],
    ];
    const loops = chainIntoClosedLoops([a, b, c, d]);
    expect(loops).toHaveLength(1);
  });
});

describe('classifyLoops', () => {
  const square = (x0: number, y0: number, size: number): Point2D[] => [
    [x0, y0],
    [x0 + size, y0],
    [x0 + size, y0 + size],
    [x0, y0 + size],
  ];

  it('a single loop with no other loops is its own outer shape with no holes', () => {
    const groups = classifyLoops([square(0, 0, 10)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].holes).toHaveLength(0);
  });

  it('a small loop nested inside a larger one becomes a hole, not a separate shape', () => {
    const outer = square(0, 0, 10);
    const hole = square(3, 3, 2);
    const groups = classifyLoops([outer, hole]);
    expect(groups).toHaveLength(1);
    expect(groups[0].holes).toHaveLength(1);
  });

  it('two unconnected loops (a DXF "nest" with multiple parts) become two separate outer groups', () => {
    const partA = square(0, 0, 10);
    const partB = square(100, 100, 10);
    const groups = classifyLoops([partA, partB]);
    expect(groups).toHaveLength(2);
    expect(groups[0].holes).toHaveLength(0);
    expect(groups[1].holes).toHaveLength(0);
  });
});

describe('DxfExtractionService.extractShapesFromDxf (end-to-end, real DXF text)', () => {
  const service = new DxfExtractionService();

  it('a closed LWPOLYLINE rectangle (100x50 DXF units, assumed mm) becomes one 10x5cm shape with no holes', async () => {
    const dxf = dxfEntitiesSection(
      lwPolylineBlock(
        [
          [0, 0],
          [100, 0],
          [100, 50],
          [0, 50],
        ],
        true,
      ),
    );
    const lines = await service.extractShapesFromDxf(Buffer.from(dxf, 'utf8'), 'rect');

    expect(lines).toHaveLength(1);
    expect(lines[0].lengthCm).toBeCloseTo(10, 5);
    expect(lines[0].widthCm).toBeCloseTo(5, 5);
    expect(lines[0].shapeKind).toBe('polygon');
    expect(lines[0].holesCm).toEqual([]);
    expect(lines[0].name).toBe('rect');
  });

  it('a standalone CIRCLE becomes its own closed shape', async () => {
    const dxf = dxfEntitiesSection(circleBlock(50, 50, 20));
    const lines = await service.extractShapesFromDxf(Buffer.from(dxf, 'utf8'), 'disc');

    expect(lines).toHaveLength(1);
    expect(lines[0].lengthCm).toBeCloseTo(4, 1); // 2*radius = 40 DXF units -> 4cm
    expect(lines[0].widthCm).toBeCloseTo(4, 1);
  });

  it('chains standalone LINE + ARC entities into one closed "stadium" outline', async () => {
    const dxf = dxfEntitiesSection(
      lineBlock(0, 10, 0, -10) + arcBlock(0, 0, 10, 90, 270) + lineBlock(0, -10, 20, -10) + arcBlock(20, 0, 10, 270, 90) + lineBlock(20, 10, 0, 10),
    );
    const lines = await service.extractShapesFromDxf(Buffer.from(dxf, 'utf8'), 'stadium');

    expect(lines).toHaveLength(1);
    expect(lines[0].holesCm).toEqual([]);
  });

  it('a rectangle containing a smaller closed rectangle produces one shape with one hole', async () => {
    const outer = lwPolylineBlock(
      [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
      true,
    );
    const hole = lwPolylineBlock(
      [
        [30, 30],
        [60, 30],
        [60, 60],
        [30, 60],
      ],
      true,
    );
    const dxf = dxfEntitiesSection(outer + hole);
    const lines = await service.extractShapesFromDxf(Buffer.from(dxf, 'utf8'), 'plate');

    expect(lines).toHaveLength(1);
    expect(lines[0].holesCm).toHaveLength(1);
  });

  it('two unconnected closed rectangles (a nested multi-part DXF) become two separate candidate lines, each named with an index', async () => {
    const partA = lwPolylineBlock(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      true,
    );
    const partB = lwPolylineBlock(
      [
        [100, 100],
        [110, 100],
        [110, 110],
        [100, 110],
      ],
      true,
    );
    const dxf = dxfEntitiesSection(partA + partB);
    const lines = await service.extractShapesFromDxf(Buffer.from(dxf, 'utf8'), 'nest');

    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.name)).toEqual(['nest — деталь 1', 'nest — деталь 2']);
  });

  it('an empty DXF (no drawable entities) yields zero shapes rather than throwing', async () => {
    const dxf = dxfEntitiesSection('');
    const lines = await service.extractShapesFromDxf(Buffer.from(dxf, 'utf8'), 'empty');
    expect(lines).toEqual([]);
  });

  it('isDxfFile recognizes the extension case-insensitively', () => {
    expect(service.isDxfFile('part.dxf')).toBe(true);
    expect(service.isDxfFile('part.DXF')).toBe(true);
    expect(service.isDxfFile('part.step')).toBe(false);
  });
});
