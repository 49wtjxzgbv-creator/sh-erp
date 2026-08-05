import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PlansService } from './plans.service';

@Module({
  controllers: [BillingController],
  providers: [BillingService, PlansService],
  exports: [BillingService, PlansService],
})
export class BillingModule {}
