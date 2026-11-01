import { Module } from '@nestjs/common';
import { BomModule } from '../bom/bom.module';
import { CuttingPlansController } from './cutting-plans.controller';
import { CuttingPlansService } from './cutting-plans.service';

@Module({
  // BomModule for StepBomExtractionService (direct-product STEP-shape
  // upload, 2026-11-01 — reuses "Креслення → специфікація"'s own
  // extraction as-is, no new parsing logic).
  imports: [BomModule],
  controllers: [CuttingPlansController],
  providers: [CuttingPlansService],
})
export class CuttingModule {}
