import { Injectable } from '@nestjs/common';
import { CodedBadRequestException, CodedNotFoundException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { FilesService } from '../files/files.service';
import { StepConversionService } from '../files/step-conversion.service';
import { DxfExtractionService } from '../files/dxf-extraction.service';
import { MatchedBomLine, toMatchedBomLine } from '../ai/match-products.util';

/**
 * Розкрій's own shape-upload entry point (2026-11-01) — the two "Завантажити
 * STEP" buttons (`cutting/specs/:productId/extract-default-shape`,
 * `cutting/extract-shape`) now accept a STEP/STP 3D CAD file OR a plain DXF
 * 2D drawing. Deliberately a SEPARATE service from
 * StepBomExtractionService (../bom/step-bom-extraction.service.ts), which
 * stays STEP-only and unchanged — that one backs the BOM "Креслення →
 * специфікація" page's multi-part assembly-tree extraction, a fundamentally
 * different operation DXF has no equivalent of (a DXF file has no
 * assembly/quantity structure, only one or several flat part outlines).
 */
@Injectable()
export class CadShapeExtractionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filesService: FilesService,
    private readonly stepConversionService: StepConversionService,
    private readonly dxfExtractionService: DxfExtractionService,
  ) {}

  async extractShape(user: RequestUser, fileAssetId: string): Promise<{ sourceFileAssetId: string; lines: MatchedBomLine[] }> {
    const fileAsset = await this.prisma.tenant.fileAsset.findUnique({ where: { id: fileAssetId } });
    if (!fileAsset || fileAsset.deletedAt) {
      throw new CodedNotFoundException('FILE_NOT_FOUND', 'File not found.');
    }

    let shapeLines;
    if (this.stepConversionService.isStepFile(fileAsset.originalName)) {
      shapeLines = await this.stepConversionService.extractBomStructure(fileAsset);
    } else if (this.dxfExtractionService.isDxfFile(fileAsset.originalName)) {
      const { bytes } = await this.filesService.getFileAssetBytes(user, fileAssetId);
      const baseName = fileAsset.originalName.replace(/\.dxf$/i, '');
      shapeLines = await this.dxfExtractionService.extractShapesFromDxf(bytes, baseName);
    } else {
      throw new CodedBadRequestException('CAD_EXTRACTION_WRONG_FILE_TYPE', 'This file is not a .step/.stp/.dxf CAD file.');
    }

    if (shapeLines.length === 0) {
      throw new CodedBadRequestException('CAD_EXTRACTION_NO_SHAPES', 'No cuttable shapes found in this file.');
    }

    const products = await this.prisma.tenant.product.findMany({ where: { deletedAt: null } });
    const lines = shapeLines.map((line) =>
      toMatchedBomLine(
        line.name,
        line.qty,
        line.dimensionsCm,
        products,
        line.lengthCm,
        line.widthCm,
        line.shapeKind === 'polygon' && line.outerCm ? { outerCm: line.outerCm, holesCm: line.holesCm ?? [] } : null,
      ),
    );

    return { sourceFileAssetId: fileAssetId, lines };
  }
}
