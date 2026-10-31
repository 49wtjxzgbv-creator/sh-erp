import { Injectable } from '@nestjs/common';
import { CodedBadRequestException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { FilesService } from '../files/files.service';
import { StepConversionService } from '../files/step-conversion.service';
import { MatchedBomLine, toMatchedBomLine } from '../ai/match-products.util';

/**
 * "Креслення → специфікація" (2026-10-31), STEP half: unlike the PDF/image
 * path (AiService#extractBomFromDrawing, Gemini vision), this reads a
 * STEP/3D CAD file's OWN embedded assembly tree — exact part names and
 * instance counts straight from the CAD structure, no AI call, no quota
 * cost. See StepConversionService#extractBomStructure's header comment for
 * why this data was always available but discarded by the existing
 * GLB-conversion pipeline.
 */
@Injectable()
export class StepBomExtractionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filesService: FilesService,
    private readonly stepConversionService: StepConversionService,
  ) {}

  async extractComponentsFromStep(user: RequestUser, fileAssetId: string): Promise<{ sourceFileAssetId: string; lines: MatchedBomLine[] }> {
    const fileAsset = await this.prisma.tenant.fileAsset.findUnique({ where: { id: fileAssetId } });
    if (!fileAsset || fileAsset.deletedAt) {
      throw new CodedBadRequestException('FILE_NOT_FOUND', 'File not found.');
    }
    if (!this.stepConversionService.isStepFile(fileAsset.originalName)) {
      throw new CodedBadRequestException('STEP_EXTRACTION_WRONG_FILE_TYPE', 'This file is not a .step/.stp CAD file.');
    }

    // Confirms the file is readable in-process before the (slower, child-
    // process) extraction call — same existence/ownership check
    // getFileAssetBytes itself does, kept here too since extractBomStructure
    // takes the raw FileAsset row, not an id, and needs the already-
    // verified row regardless.
    await this.filesService.getFileAssetBytes(user, fileAssetId);

    const stepLines = await this.stepConversionService.extractBomStructure(fileAsset);
    if (stepLines.length === 0) {
      throw new CodedBadRequestException('STEP_EXTRACTION_NO_PARTS', 'No parts found in this STEP file\'s assembly structure.');
    }

    const products = await this.prisma.tenant.product.findMany({ where: { deletedAt: null } });
    const lines = stepLines.map((line) => toMatchedBomLine(line.name, line.qty, line.dimensionsCm, products));

    return { sourceFileAssetId: fileAssetId, lines };
  }
}
