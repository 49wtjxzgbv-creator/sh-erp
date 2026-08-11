import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FilesService } from '../files/files.service';
import type { ImportConnectorProvider } from './providers/provider.interface';
import type { TransformedImportGraph } from './transform';

export interface PhotoImportSummary {
  attempted: number;
  succeeded: number;
  failed: number;
  skippedMissingEntity: number;
}

const MIME_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * Phase 3 of the universal import platform: for every `{legacyEntityType,
 * entityId, driveFileId}` transform discovered (a Product/Assembly
 * PhotoUrl column that parsed as a Drive share link), fetch the actual
 * bytes from the connector (`action=photo`) and store them as a real
 * `FileAsset`, the exact same model/domain the app's own Product/Assembly
 * photo-upload feature already uses — so an imported photo shows up in the
 * catalog/BOM thumbnail exactly like one uploaded by hand.
 *
 * Deliberately does NOT wrap the whole batch in one DB transaction: each
 * photo does one slow external HTTP call (the connector's own Drive fetch,
 * up to the provider's multi-minute ceiling for a large file) plus one R2
 * PUT, and this codebase already burned a real incident on holding a
 * transaction open across slow external I/O (see `PrismaService`'s
 * `runInTenantTransaction` and `report.ts`'s fix history) — the existence
 * checks and each FileAsset write open their own short transaction
 * instead (`FilesService.ingestPhotoAsset`), never the whole loop.
 */
@Injectable()
export class PhotoImportService {
  private readonly logger = new Logger(PhotoImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly filesService: FilesService,
  ) {}

  async importPhotos(
    companyId: string,
    actorUserId: string,
    provider: ImportConnectorProvider<unknown>,
    config: unknown,
    photoRefs: TransformedImportGraph['photoRefs'],
    onProgress: (processed: number) => Promise<void>,
  ): Promise<PhotoImportSummary> {
    if (photoRefs.length === 0) return { attempted: 0, succeeded: 0, failed: 0, skippedMissingEntity: 0 };

    const productRefIds = photoRefs.filter((r) => r.legacyEntityType === 'Product').map((r) => r.entityId);
    const assemblyRefIds = photoRefs.filter((r) => r.legacyEntityType === 'Assembly').map((r) => r.entityId);

    // Existence check, not the photo fetch itself — fast, DB-only, so a single short transaction is fine here (contrast with the loop below).
    const { productIds, assemblyIds } = await this.prisma.runInTenantTransaction(
      { companyId, userId: actorUserId },
      async (tx) => {
        const products = productRefIds.length
          ? await tx.product.findMany({ where: { companyId, id: { in: productRefIds } }, select: { id: true } })
          : [];
        const assemblies = assemblyRefIds.length
          ? await tx.assembly.findMany({ where: { companyId, id: { in: assemblyRefIds } }, select: { id: true } })
          : [];
        return { productIds: new Set(products.map((p) => p.id)), assemblyIds: new Set(assemblies.map((a) => a.id)) };
      },
    );

    let succeeded = 0;
    let failed = 0;
    let skippedMissingEntity = 0;

    for (let i = 0; i < photoRefs.length; i++) {
      const ref = photoRefs[i];
      const entityExists = ref.legacyEntityType === 'Product' ? productIds.has(ref.entityId) : assemblyIds.has(ref.entityId);

      if (!entityExists) {
        skippedMissingEntity++;
        this.logger.warn(
          `[photo-import] ${ref.legacyEntityType} ${ref.entityId} was never loaded (e.g. a Product dropped for an unresolved unit) — photo driveFileId=${ref.driveFileId} skipped.`,
        );
        await onProgress(i + 1);
        continue;
      }

      try {
        const { base64, mimeType } = await provider.fetchPhoto(config, { id: ref.driveFileId });
        const bytes = Buffer.from(base64, 'base64');
        const extension = MIME_EXTENSION[mimeType] ?? 'jpg';

        await this.filesService.ingestPhotoAsset({
          companyId,
          actorUserId,
          domain: ref.legacyEntityType === 'Product' ? 'PRODUCT_PHOTO' : 'ASSEMBLY_PHOTO',
          entityType: ref.legacyEntityType,
          entityId: ref.entityId,
          legacyId: ref.driveFileId,
          originalName: `${ref.driveFileId}.${extension}`,
          mimeType: mimeType || 'image/jpeg',
          bytes,
        });
        succeeded++;
      } catch (err) {
        failed++;
        this.logger.warn(
          `[photo-import] Failed to migrate photo driveFileId=${ref.driveFileId} for ${ref.legacyEntityType} ${ref.entityId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      await onProgress(i + 1);
    }

    return { attempted: photoRefs.length, succeeded, failed, skippedMissingEntity };
  }
}
