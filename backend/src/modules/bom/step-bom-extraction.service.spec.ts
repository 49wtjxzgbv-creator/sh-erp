import { BadRequestException } from '@nestjs/common';
import { StepBomExtractionService } from './step-bom-extraction.service';

describe('StepBomExtractionService', () => {
  let service: StepBomExtractionService;
  let prisma: any;
  let filesService: any;
  let stepConversionService: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };
  const fileAsset = { id: 'f1', originalName: 'bracket-assembly.step', deletedAt: null };

  beforeEach(() => {
    prisma = {
      tenant: {
        fileAsset: { findUnique: jest.fn().mockResolvedValue(fileAsset) },
        product: { findMany: jest.fn().mockResolvedValue([]) },
      },
    };
    filesService = { getFileAssetBytes: jest.fn().mockResolvedValue({ bytes: Buffer.from(''), mimeType: 'model/step', originalName: fileAsset.originalName }) };
    stepConversionService = {
      isStepFile: jest.fn().mockReturnValue(true),
      extractBomStructure: jest.fn().mockResolvedValue([{ name: 'Гвинт M6x20', qty: 3, dimensionsCm: '2×0.6×0.6 см (за геометрією)' }]),
    };
    service = new StepBomExtractionService(prisma, filesService, stepConversionService);
  });

  it('reads the real assembly-tree structure (no AI) and fuzzy-matches the result against existing Products', async () => {
    prisma.tenant.product.findMany.mockResolvedValue([{ id: 'p1', article: 'SCR-6', name: 'Гвинт M6x20' }]);

    const result = await service.extractComponentsFromStep(user, 'f1');

    expect(stepConversionService.extractBomStructure).toHaveBeenCalledWith(fileAsset);
    expect(result).toEqual({
      sourceFileAssetId: 'f1',
      lines: [expect.objectContaining({ rawName: 'Гвинт M6x20', qty: 3, matched: true, productId: 'p1' })],
    });
  });

  it('carries the real contour through to shapePolygon when the STEP path found one (irregular-shape nesting, 2026-11-01)', async () => {
    stepConversionService.extractBomStructure.mockResolvedValue([
      {
        name: 'Лист з отвором',
        qty: 1,
        dimensionsCm: '10×10×0.2 см (за геометрією)',
        lengthCm: 10,
        widthCm: 10,
        heightCm: 0.2,
        shapeKind: 'polygon',
        outerCm: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
        holesCm: [
          [
            [3, 3],
            [7, 3],
            [7, 7],
            [3, 7],
          ],
        ],
      },
    ]);

    const result = await service.extractComponentsFromStep(user, 'f1');

    expect(result.lines[0].shapePolygon).toEqual({
      outerCm: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      holesCm: [
        [
          [3, 3],
          [7, 3],
          [7, 7],
          [3, 7],
        ],
      ],
    });
  });

  it('leaves shapePolygon null when the STEP path only found a bounding box (shapeKind "bbox")', async () => {
    const result = await service.extractComponentsFromStep(user, 'f1'); // beforeEach's default mock has no shapeKind at all
    expect(result.lines[0].shapePolygon).toBeNull();
  });

  it('rejects a file that is not a .step/.stp CAD file', async () => {
    stepConversionService.isStepFile.mockReturnValue(false);
    await expect(service.extractComponentsFromStep(user, 'f1')).rejects.toThrow(BadRequestException);
    expect(stepConversionService.extractBomStructure).not.toHaveBeenCalled();
  });

  it('throws when the file does not exist (or belongs to a different tenant — findUnique is already RLS-scoped)', async () => {
    prisma.tenant.fileAsset.findUnique.mockResolvedValue(null);
    await expect(service.extractComponentsFromStep(user, 'missing')).rejects.toThrow(BadRequestException);
  });

  it('throws when OCCT found no parts in the assembly structure at all', async () => {
    stepConversionService.extractBomStructure.mockResolvedValue([]);
    await expect(service.extractComponentsFromStep(user, 'f1')).rejects.toThrow(BadRequestException);
  });
});
