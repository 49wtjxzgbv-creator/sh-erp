import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { QueryFinishedGoodsDto, ReceivePurchasedFinishedGoodsDto } from './dto/finished-goods.dto';
import { FinishedGoodsService } from './finished-goods.service';

@ApiTags('production')
@Controller({ path: 'finished-goods', version: '1' })
export class FinishedGoodsController {
  constructor(private readonly finishedGoodsService: FinishedGoodsService) {}

  @Get()
  @RequirePermissions('finished-goods:read')
  @ApiOperation({ summary: 'Search/list finished goods (serialized units), paginated.' })
  async query(@CurrentUser() user: RequestUser, @Query() query: QueryFinishedGoodsDto) {
    return this.finishedGoodsService.query(user, query);
  }

  @Get('summary')
  @RequirePermissions('finished-goods:read')
  @ApiOperation({ summary: 'One row per Assembly with its IN_STOCK count — "Склад → Готова продукція" grouped view, distinct from the flat per-serial list above.' })
  async summary(@CurrentUser() user: RequestUser) {
    return this.finishedGoodsService.summaryByAssembly(user);
  }

  @Get(':id')
  @RequirePermissions('finished-goods:read')
  @ApiOperation({ summary: 'Get one finished good by id.' })
  async findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.finishedGoodsService.findOne(user, id);
  }

  @Delete(':id')
  @RequirePermissions('finished-goods:delete')
  @ApiOperation({ summary: 'Permanently delete a finished-good unit — IN_STOCK only, and only if it has no QC checks or shipment records attached.' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.finishedGoodsService.remove(user, id);
    return { ok: true };
  }

  @Post('receive-purchased')
  @RequirePermissions('finished-goods:manage')
  @ApiOperation({
    summary:
      'Stock units of an assembly bought ready-made from a supplier, without going through the ProductionOrder ' +
      'create->start lifecycle — no BOM consumption, no labor fund (there is none to freeze).',
  })
  async receivePurchased(@CurrentUser() user: RequestUser, @Body() dto: ReceivePurchasedFinishedGoodsDto) {
    return this.finishedGoodsService.receivePurchased(user, dto);
  }
}
