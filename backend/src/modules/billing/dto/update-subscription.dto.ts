import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

const PLAN_KEYS = ['starter', 'growth', 'enterprise'] as const;

export class UpdateSubscriptionDto {
  @ApiProperty({ enum: PLAN_KEYS, description: 'Billing stub (Phase 0) — no real Stripe checkout yet, this just switches the company\'s recorded plan.' })
  @IsIn(PLAN_KEYS)
  planKey!: (typeof PLAN_KEYS)[number];
}
