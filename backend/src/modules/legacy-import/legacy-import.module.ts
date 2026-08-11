import { Module } from '@nestjs/common';
import { LegacyImportController } from './legacy-import.controller';
import { LegacyImportService } from './legacy-import.service';
import { PhotoImportService } from './photo-import.service';
import { ImportPairingPrismaService } from '../../prisma/import-pairing-prisma.service';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [FilesModule],
  controllers: [LegacyImportController],
  // ImportPairingPrismaService is deliberately NOT exported — same usage
  // boundary as AuthPrismaService in IdentityModule (see that class's
  // header comment): only LegacyImportService's completePairing path may
  // ever touch it.
  providers: [LegacyImportService, PhotoImportService, ImportPairingPrismaService],
  exports: [LegacyImportService],
})
export class LegacyImportModule {}
