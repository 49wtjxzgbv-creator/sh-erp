import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { SaveMaterialProvisioningDecisionDto } from './dto/material-provisioning.dto';
import { MaterialProvisioningService } from './material-provisioning.service';

@ApiTags('sales')
@Controller({ path: 'customer-orders/:orderId/items/:itemId/provisioning', version: '1' })
export class MaterialProvisioningController {
  constructor(private readonly service: MaterialProvisioningService) {}

  @Get()
  @RequirePermissions('customer-orders:read')
  @ApiOperation({ summary: 'Stock-reservation spec §12: per-material coverage summary for one order line (physical/reserved/available/ordered/received/covered, live-computed).' })
  async getSummary(@CurrentUser() user: RequestUser, @Param('orderId') orderId: string, @Param('itemId') itemId: string) {
    return this.service.getItemSummary(user, orderId, itemId);
  }

  @Put(':productId')
  @RequirePermissions('customer-orders:manage')
  @ApiOperation({ summary: '§2/§3: save the stock-vs-purchase split for one material on this line — immediately reserves the stock-side delta.' })
  async saveDecision(
    @CurrentUser() user: RequestUser,
    @Param('orderId') orderId: string,
    @Param('itemId') itemId: string,
    @Param('productId') productId: string,
    @Body() dto: SaveMaterialProvisioningDecisionDto,
  ) {
    return this.service.saveDecision(user, orderId, itemId, productId, dto);
  }
}
