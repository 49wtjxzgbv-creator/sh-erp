import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RecordInventoryCountDto, StartInventorySessionDto } from './dto/inventory-session.dto';
import { InventorySessionsService } from './inventory-sessions.service';

@ApiTags('inventory')
@Controller({ path: 'inventory-sessions', version: '1' })
export class InventorySessionsController {
  constructor(private readonly sessionsService: InventorySessionsService) {}

  @Post()
  @RequirePermissions('inventory-sessions:manage')
  @ApiOperation({ summary: 'Start a stocktake — snapshots every active product\'s current quantity as expectedQty.' })
  async start(@CurrentUser() user: RequestUser, @Body() dto: StartInventorySessionDto) {
    return this.sessionsService.start(user, dto);
  }

  @Get()
  @RequirePermissions('inventory-sessions:manage')
  @ApiOperation({ summary: 'List inventory sessions.' })
  async list(@CurrentUser() user: RequestUser) {
    return this.sessionsService.list(user);
  }

  @Get(':id/items')
  @RequirePermissions('inventory-sessions:manage')
  @ApiOperation({ summary: 'List the count lines for a session.' })
  async items(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.sessionsService.getItems(user, id);
  }

  @Post(':id/counts')
  @RequirePermissions('inventory-sessions:manage')
  @ApiOperation({ summary: 'Record a counted quantity for one product in this session.' })
  async recordCount(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: RecordInventoryCountDto,
  ) {
    return this.sessionsService.recordCount(user, id, dto);
  }

  @Post(':id/complete')
  @RequirePermissions('inventory-sessions:manage')
  @ApiOperation({ summary: 'Complete the session — posts INVENTORY_RECONCILIATION movements for every discrepancy.' })
  async complete(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.sessionsService.complete(user, id);
  }
}
