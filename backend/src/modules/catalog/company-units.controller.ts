import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CompanyUnitsService } from './company-units.service';
import { CreateCompanyUnitDto } from './dto/company-unit.dto';

@ApiTags('catalog')
@Controller({ path: 'company-units', version: '1' })
export class CompanyUnitsController {
  constructor(private readonly unitsService: CompanyUnitsService) {}

  @Post()
  @RequirePermissions('units:manage')
  @ApiOperation({ summary: 'Add a unit of measure.' })
  async create(@Body() dto: CreateCompanyUnitDto) {
    return this.unitsService.create(dto);
  }

  @Get()
  @RequirePermissions('products:read')
  @ApiOperation({ summary: 'List units of measure.' })
  async list() {
    return this.unitsService.list();
  }

  @Delete(':id')
  @RequirePermissions('units:manage')
  @ApiOperation({ summary: 'Delete a unit (rejected if any product still references it).' })
  async remove(@Param('id') id: string) {
    return this.unitsService.remove(id);
  }
}
