import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { BillingService } from './billing.service';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { PlansService } from './plans.service';

@ApiTags('billing')
@Controller({ path: 'billing', version: '1' })
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly plansService: PlansService,
  ) {}

  @Get('plans')
  @ApiOperation({ summary: 'List available billing plans (Phase 0 stub — no permission gate, every authenticated role can see pricing tiers).' })
  async listPlans() {
    return this.plansService.list();
  }

  @Get('subscription')
  @RequirePermissions('company:billing')
  @ApiOperation({ summary: "This company's current subscription + plan." })
  async getSubscription(@CurrentUser() user: RequestUser) {
    return this.billingService.getSubscription(user);
  }

  @Put('subscription')
  @RequirePermissions('company:billing')
  @ApiOperation({ summary: 'Switch plan (stub — records the change, does not collect payment; real Stripe checkout is future work).' })
  async updateSubscription(@CurrentUser() user: RequestUser, @Body() dto: UpdateSubscriptionDto) {
    return this.billingService.updatePlan(user, dto);
  }
}
