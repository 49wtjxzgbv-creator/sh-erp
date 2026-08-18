import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AssembliesService } from './assemblies.service';
import { SetAssemblyComponentsDto } from './dto/assembly-component.dto';
import { SetAssemblySuppliersDto } from './dto/assembly-supplier.dto';
import { CreateAssemblyDto, UpdateAssemblyDto } from './dto/assembly.dto';
import { CheckAvailabilityDto, ProduceAssemblyDto } from './dto/produce-assembly.dto';
import { QueryAssembliesDto } from './dto/query-assemblies.dto';

@ApiTags('bom')
@Controller({ path: 'assemblies', version: '1' })
export class AssembliesController {
  constructor(private readonly assembliesService: AssembliesService) {}

  @Post()
  @RequirePermissions('assemblies:write')
  @ApiOperation({ summary: 'Create an assembly (BOM header).' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateAssemblyDto) {
    return this.assembliesService.create(user, dto);
  }

  @Get()
  @RequirePermissions('assemblies:read')
  @ApiOperation({ summary: 'Search/list assemblies, paginated.' })
  async query(@CurrentUser() user: RequestUser, @Query() query: QueryAssembliesDto) {
    return this.assembliesService.query(user, query);
  }

  @Get(':id')
  @RequirePermissions('assemblies:read')
  @ApiOperation({ summary: 'Get one assembly with its current BOM lines.' })
  async findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.assembliesService.findOne(user, id);
  }

  @Patch(':id')
  @RequirePermissions('assemblies:write')
  @ApiOperation({ summary: 'Update assembly header fields (name, cost-per-unit fields, etc.) — not BOM lines.' })
  async update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateAssemblyDto) {
    return this.assembliesService.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('assemblies:write')
  @ApiOperation({ summary: 'Soft-delete an assembly.' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.assembliesService.remove(user, id);
  }

  @Get(':id/components')
  @RequirePermissions('assemblies:read')
  @ApiOperation({ summary: 'Get the current BOM line list.' })
  async getComponents(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.assembliesService.getComponents(user, id);
  }

  @Put(':id/components')
  @RequirePermissions('assemblies:write')
  @ApiOperation({ summary: 'Replace the full BOM line list and write a new immutable version snapshot.' })
  async setComponents(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: SetAssemblyComponentsDto,
  ) {
    return this.assembliesService.setComponents(user, id, dto);
  }

  @Get(':id/suppliers')
  @RequirePermissions('assemblies:read')
  @ApiOperation({ summary: 'Linked suppliers for this assembly, each with its own optional price.' })
  async getSuppliers(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.assembliesService.getSuppliers(user, id);
  }

  @Put(':id/suppliers')
  @RequirePermissions('assemblies:write')
  @ApiOperation({ summary: 'Replace the full linked-supplier list for this assembly.' })
  async setSuppliers(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: SetAssemblySuppliersDto) {
    return this.assembliesService.setSuppliers(user, id, dto);
  }

  @Get(':id/versions')
  @RequirePermissions('assemblies:read')
  @ApiOperation({ summary: 'List immutable BOM version snapshots for this assembly, newest first.' })
  async getVersions(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.assembliesService.getVersions(user, id);
  }

  @Get(':id/versions/:versionId')
  @RequirePermissions('assemblies:read')
  @ApiOperation({ summary: 'Get one immutable BOM version snapshot with its component lines.' })
  async getVersion(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.assembliesService.getVersion(user, id, versionId);
  }

  @Get(':id/cost')
  @RequirePermissions('assemblies:read')
  @ApiOperation({ summary: 'Recursive per-unit cost calculation from Product.sellPriceEur, cycle-protected (calcAssemblyCost_ port).' })
  async calculateCost(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.assembliesService.calculateCost(user, id);
  }

  @Post(':id/check-availability')
  @RequirePermissions('assemblies:read')
  @ApiOperation({ summary: 'Flatten the BOM recursively to real Product requirements and check current stock against them.' })
  async checkAvailability(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CheckAvailabilityDto,
  ) {
    return this.assembliesService.checkAvailability(user, id, dto.qty);
  }

  @Post(':id/produce')
  @RequirePermissions('assemblies:write')
  @ApiOperation({
    summary:
      'Reservation-free direct-produce path ("Дати в роботу"): checks availability then immediately consumes ' +
      'components. Does not create FinishedGoods serials or go through the stage tracker — distinct from the ' +
      'full ProductionOrder lifecycle (Module 6), preserved as a separate path per Phase 1 §6.1.',
  })
  async produce(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: ProduceAssemblyDto) {
    return this.assembliesService.produce(user, id, dto);
  }
}
