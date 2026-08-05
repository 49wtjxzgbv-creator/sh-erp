import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CreateWarehouseDto, UpdateWarehouseDto } from './dto/warehouse.dto';
import { WarehousesService } from './warehouses.service';

@ApiTags('inventory')
@Controller({ path: 'warehouses', version: '1' })
export class WarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  @Post()
  @RequirePermissions('warehouses:manage')
  @ApiOperation({ summary: 'Create a warehouse.' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateWarehouseDto) {
    return this.warehousesService.create(user, dto);
  }

  @Get()
  @RequirePermissions('stock:read')
  @ApiOperation({ summary: 'List warehouses.' })
  async list(@CurrentUser() user: RequestUser) {
    return this.warehousesService.list(user);
  }

  @Get(':id')
  @RequirePermissions('stock:read')
  @ApiOperation({ summary: 'Get one warehouse.' })
  async findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.warehousesService.findOne(user, id);
  }

  @Patch(':id')
  @RequirePermissions('warehouses:manage')
  @ApiOperation({ summary: 'Update a warehouse.' })
  async update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateWarehouseDto) {
    return this.warehousesService.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('warehouses:manage')
  @ApiOperation({ summary: 'Soft-delete a warehouse (rejected if it still holds nonzero stock).' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.warehousesService.remove(user, id);
  }
}
