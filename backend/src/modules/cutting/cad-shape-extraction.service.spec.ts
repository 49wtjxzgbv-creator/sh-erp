import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CadShapeExtractionService } from './cad-shape-extraction.service';

describe('CadShapeExtractionService', () => {
  let service: CadShapeExtractionService;
  let prisma: any;
  let filesService: any;
  let stepConversionService: any;
  let dxfExtractionService: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        fileAsset: { findUnique: jest.fn() },
        product: { findMany: jest.fn().mockResolvedValue([]) },
      },
    };
    filesService = { getFileAssetBytes: jest.fn().mockResolvedValue({ bytes: Buffer.from('dxf-bytes'), mimeType: 'application/dxf', originalName: 'part.dxf' }) };
    stepConversionService = {
      isStepFile: jest.fn((name: string) => /\.(step|stp)$/i.test(name)),
      extractBomStructure: jest.fn().mockResolvedValue([{ name: 'Кронштейн', qty: 1, dimensionsCm: '10×5×2 см (за геометрією)' }]),
    };
    dxfExtractionService = {
      isDxfFile: jest.fn((name: string) => /\.dxf$/i.test(name)),
      extractShapesFromDxf: jest.fn().mockResolvedValue([
        {
          name: 'part',
          qty: 1,
          dimensionsCm: '10×5 см (за геометрією)',
          lengthCm: 10,
          widthCm: 5,
          heightCm: null,
          shapeKind: 'polygon',
          outerCm: [
            [0, 0],
            [10, 0],
            [10, 5],
            [0, 5],
          ],
          holesCm: [],
        },
      ]),
    };
    service = new CadShapeExtractionService(prisma, filesService, stepConversionService, dxfExtractionService);
  });

  it('dispatches a .step file to StepConversionService, never touching DxfExtractionService', async () => {
    prisma.tenant.fileAsset.findUnique.mockResolvedValue({ id: 'f1', originalName: 'bracket.step', deletedAt: null });

    const result = await service.extractShape(user, 'f1');

    expect(stepConversionService.extractBomStructure).toHaveBeenCalledTimes(1);
    expect(dxfExtractionService.extractShapesFromDxf).not.toHaveBeenCalled();
    expect(result.lines[0].rawName).toBe('Кронштейн');
  });

  it('dispatches a .dxf file to DxfExtractionService, never touching StepConversionService', async () => {
    prisma.tenant.fileAsset.findUnique.mockResolvedValue({ id: 'f1', originalName: 'part.dxf', deletedAt: null });

    const result = await service.extractShape(user, 'f1');

    expect(filesService.getFileAssetBytes).toHaveBeenCalledWith(user, 'f1');
    expect(dxfExtractionService.extractShapesFromDxf).toHaveBeenCalledWith(Buffer.from('dxf-bytes'), 'part');
    expect(stepConversionService.extractBomStructure).not.toHaveBeenCalled();
    expect(result.lines[0].shapePolygon).toEqual({
      outerCm: [
        [0, 0],
        [10, 0],
        [10, 5],
        [0, 5],
      ],
      holesCm: [],
    });
  });

  it('rejects a file that is neither STEP/STP nor DXF', async () => {
    prisma.tenant.fileAsset.findUnique.mockResolvedValue({ id: 'f1', originalName: 'drawing.pdf', deletedAt: null });

    await expect(service.extractShape(user, 'f1')).rejects.toThrow(BadRequestException);
    expect(stepConversionService.extractBomStructure).not.toHaveBeenCalled();
    expect(dxfExtractionService.extractShapesFromDxf).not.toHaveBeenCalled();
  });

  it('throws when the file does not exist (or belongs to a different tenant — findUnique is already RLS-scoped)', async () => {
    prisma.tenant.fileAsset.findUnique.mockResolvedValue(null);
    await expect(service.extractShape(user, 'missing')).rejects.toThrow(NotFoundException);
  });

  it('throws CAD_EXTRACTION_NO_SHAPES when the DXF parsed cleanly but found zero closed shapes', async () => {
    prisma.tenant.fileAsset.findUnique.mockResolvedValue({ id: 'f1', originalName: 'empty.dxf', deletedAt: null });
    dxfExtractionService.extractShapesFromDxf.mockResolvedValue([]);

    await expect(service.extractShape(user, 'f1')).rejects.toThrow(BadRequestException);
  });

  it('throws CAD_EXTRACTION_NO_SHAPES when a STEP file has no parts in its assembly structure', async () => {
    prisma.tenant.fileAsset.findUnique.mockResolvedValue({ id: 'f1', originalName: 'bracket.step', deletedAt: null });
    stepConversionService.extractBomStructure.mockResolvedValue([]);

    await expect(service.extractShape(user, 'f1')).rejects.toThrow(BadRequestException);
  });

  it('fuzzy-matches extracted lines against existing Products, same as the STEP-only path always did', async () => {
    prisma.tenant.fileAsset.findUnique.mockResolvedValue({ id: 'f1', originalName: 'part.dxf', deletedAt: null });
    prisma.tenant.product.findMany.mockResolvedValue([{ id: 'p1', article: 'PLT-1', name: 'part' }]);

    const result = await service.extractShape(user, 'f1');

    expect(result).toEqual({
      sourceFileAssetId: 'f1',
      lines: [expect.objectContaining({ rawName: 'part', matched: true, productId: 'p1' })],
    });
  });
});
