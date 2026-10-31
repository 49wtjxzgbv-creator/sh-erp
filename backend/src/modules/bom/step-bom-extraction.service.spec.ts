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
