import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CreateTransportUnitTypeDto, UpdateTransportUnitTypeDto } from './dto/transport-unit-type.dto';
import { TransportUnitTypesService } from './transport-unit-types.service';

@ApiTags('logistics')
@Controller({ path: 'transport-unit-types', version: '1' })
export class TransportUnitTypesController {
  constructor(private readonly transportUnitTypesService: TransportUnitTypesService) {}

  @Post()
  @RequirePermissions('transport-unit-types:manage')
  @ApiOperation({ summary: 'Create a transport unit type (e.g. a truck or container model).' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateTransportUnitTypeDto) {
    return this.transportUnitTypesService.create(user, dto);
  }

  @Get()
  @RequirePermissions('transport-unit-types:manage')
  @ApiOperation({ summary: 'List transport unit types.' })
  async list(@CurrentUser() user: RequestUser) {
    return this.transportUnitTypesService.list(user);
  }

  @Get(':id')
  @RequirePermissions('transport-unit-types:manage')
  @ApiOperation({ summary: 'Get one transport unit type.' })
  async findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.transportUnitTypesService.findOne(user, id);
  }

  @Patch(':id')
  @RequirePermissions('transport-unit-types:manage')
  @ApiOperation({ summary: 'Update a transport unit type.' })
  async update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateTransportUnitTypeDto) {
    return this.transportUnitTypesService.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('transport-unit-types:manage')
  @ApiOperation({ summary: 'Soft-delete a transport unit type.' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.transportUnitTypesService.remove(user, id);
  }
}
