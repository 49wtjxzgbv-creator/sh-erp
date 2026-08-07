import { Module } from '@nestjs/common';
import { LegacyImportController } from './legacy-import.controller';
import { LegacyImportService } from './legacy-import.service';
import { ImportPairingPrismaService } from '../../prisma/import-pairing-prisma.service';

@Module({
  controllers: [LegacyImportController],
  // ImportPairingPrismaService is deliberately NOT exported — same usage
  // boundary as AuthPrismaService in IdentityModule (see that class's
  // header comment): only LegacyImportService's completePairing path may
  // ever touch it.
  providers: [LegacyImportService, ImportPairingPrismaService],
  exports: [LegacyImportService],
})
export class LegacyImportModule {}
