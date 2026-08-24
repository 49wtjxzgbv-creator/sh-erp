import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import {
  CorrectProductionExecutionDto,
  CreateProductionExecutionDto,
  PatchProductionExecutionDto,
  QueryProductionExecutionsDto,
  VoidProductionExecutionDto,
} from './dto/production-execution.dto';
import { ProductionExecutionsService } from './production-executions.service';

@ApiTags('production')
@Controller({ path: 'production-executions', version: '1' })
export class ProductionExecutionsController {
  constructor(private readonly service: ProductionExecutionsService) {}

  @Post()
  @RequirePermissions('production-executions:record')
  @ApiOperation({ summary: 'Record a DRAFT execution against a ProductionOrder batch (PRODUCT) or a WorkTask (GENERAL).' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateProductionExecutionDto) {
    return this.service.create(user, dto);
  }

  @Get()
  @RequirePermissions('production-executions:read')
  @ApiOperation({ summary: 'List executions, paginated.' })
  async query(@CurrentUser() user: RequestUser, @Query() query: QueryProductionExecutionsDto) {
    return this.service.query(user, query);
  }

  @Get(':id')
  @RequirePermissions('production-executions:read')
  async findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.findOne(user, id);
  }

  @Patch(':id')
  @RequirePermissions('production-executions:record')
  @ApiOperation({ summary: 'Edit a DRAFT execution — rejected once CONFIRMED.' })
  async patch(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: PatchProductionExecutionDto) {
    return this.service.patch(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('production-executions:record')
  @ApiOperation({ summary: 'Delete a DRAFT execution — a CONFIRMED one must be voided instead.' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.service.remove(user, id);
    return { success: true };
  }

  @Post(':id/confirm')
  @RequirePermissions('production-executions:confirm')
  @ApiOperation({ summary: 'Confirm a DRAFT execution — generates its PayrollEntry rows. The only place PIECEWORK entries are created.' })
  async confirm(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.confirm(user, id);
  }

  @Post(':id/void')
  @RequirePermissions('production-executions:confirm')
  @ApiOperation({ summary: 'Void a CONFIRMED execution with compensating PayrollEntry rows. History stays fully visible.' })
  async void_(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: VoidProductionExecutionDto) {
    return this.service.void_(user, id, dto);
  }

  @Post(':id/correct')
  @RequirePermissions('production-executions:confirm')
  @ApiOperation({ summary: 'Void a CONFIRMED execution and record its replacement in one step (replacement is left DRAFT — confirm it separately).' })
  async correct(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: CorrectProductionExecutionDto) {
    return this.service.correct(user, id, dto);
  }
}
