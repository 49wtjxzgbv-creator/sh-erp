import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ProductionScheduleSlotsService } from './production-schedule-slots.service';
import { CreateProductionScheduleSlotDto, UpdateProductionScheduleSlotDto } from './dto/production-schedule-slot.dto';

// Reuses production-orders:read/manage rather than minting a new
// permission key — a schedule slot is a sub-feature of production
// planning, and adding a brand-new permission would need seeding it onto
// existing roles too (out of scope for this pass).
@ApiTags('production')
@Controller({ path: 'production-schedule-slots', version: '1' })
export class ProductionScheduleSlotsController {
  constructor(private readonly slotsService: ProductionScheduleSlotsService) {}

  @Post()
  @RequirePermissions('production-orders:manage')
  @ApiOperation({ summary: 'Reserve a forward-planning slot on the production schedule, before a real order exists.' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateProductionScheduleSlotDto) {
    return this.slotsService.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('production-orders:manage')
  @ApiOperation({ summary: 'Update a not-yet-converted slot.' })
  async update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateProductionScheduleSlotDto) {
    return this.slotsService.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('production-orders:manage')
  @ApiOperation({ summary: 'Delete a slot — a genuine delete, not soft-delete (a plan, not a business record).' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.slotsService.remove(user, id);
  }

  @Post(':id/convert')
  @RequirePermissions('production-orders:manage')
  @ApiOperation({ summary: 'Turn a slot into a real ProductionOrder (via the normal create() path) once its assembly/units are set.' })
  async convert(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.slotsService.convert(user, id);
  }
}
