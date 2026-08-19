import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { MoveStockDto, QueryStockDto, QueryStockHistoryDto, QueryStockReservationsDto, RecordStockMovementDto } from './dto/stock-movement.dto';
import { StockReservationService } from './stock-reservation.service';
import { StockService } from './stock.service';

@ApiTags('inventory')
@Controller({ path: 'stock', version: '1' })
export class StockController {
  constructor(
    private readonly stockService: StockService,
    private readonly stockReservationService: StockReservationService,
  ) {}

  @Post('movements')
  @RequirePermissions('stock:adjust')
  @ApiOperation({ summary: 'Record a single-warehouse stock movement (receive/issue/adjust/write-off).' })
  async recordMovement(@CurrentUser() user: RequestUser, @Body() dto: RecordStockMovementDto) {
    return this.stockService.recordMovement(user, dto);
  }

  @Post('move')
  @RequirePermissions('stock:adjust')
  @ApiOperation({ summary: 'Move stock between two warehouses (two linked, correlated movements).' })
  async move(@CurrentUser() user: RequestUser, @Body() dto: MoveStockDto) {
    return this.stockService.move(user, dto);
  }

  @Get('levels')
  @RequirePermissions('stock:read')
  @ApiOperation({ summary: 'Current stock levels, optionally filtered by product/warehouse.' })
  async levels(@CurrentUser() user: RequestUser, @Query() query: QueryStockDto) {
    return this.stockService.getLevels(user, query);
  }

  @Get('movements')
  @RequirePermissions('stock:read')
  @ApiOperation({ summary: 'Stock movement history, paginated, newest first.' })
  async history(@CurrentUser() user: RequestUser, @Query() query: QueryStockHistoryDto) {
    return this.stockService.getHistory(user, query);
  }

  @Get('reservations')
  @RequirePermissions('stock:read')
  @ApiOperation({ summary: 'Stock-reservation spec §17: breakdown of every active reservation against one (product, warehouse) — which orders hold how much.' })
  async reservations(@CurrentUser() user: RequestUser, @Query() query: QueryStockReservationsDto) {
    return this.stockReservationService.getBreakdown(user, query.productId, query.warehouseId);
  }
}
