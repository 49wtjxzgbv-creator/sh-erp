import { Module } from '@nestjs/common';
import { CuttingPlansController } from './cutting-plans.controller';
import { CuttingPlansService } from './cutting-plans.service';

@Module({
  controllers: [CuttingPlansController],
  providers: [CuttingPlansService],
})
export class CuttingModule {}
