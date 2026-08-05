import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CreateProductionStageDto, ReorderProductionStagesDto } from './dto/production-stage.dto';
import { ProductionStagesService } from './production-stages.service';

@ApiTags('production')
@Controller({ path: 'production-stages', version: '1' })
export class ProductionStagesController {
  constructor(private readonly stagesService: ProductionStagesService) {}

  @Post()
  @RequirePermissions('production-stages:manage')
  @ApiOperation({ summary: 'Add a production stage at the end of the list.' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateProductionStageDto) {
    return this.stagesService.create(user, dto);
  }

  @Get()
  @RequirePermissions('production-orders:read')
  @ApiOperation({ summary: 'List production stages in order.' })
  async list(@CurrentUser() user: RequestUser) {
    return this.stagesService.list(user);
  }

  @Put('reorder')
  @RequirePermissions('production-stages:manage')
  @ApiOperation({ summary: 'Rewrite the stage order.' })
  async reorder(@CurrentUser() user: RequestUser, @Body() dto: ReorderProductionStagesDto) {
    return this.stagesService.reorder(user, dto);
  }

  @Delete(':id')
  @RequirePermissions('production-stages:manage')
  @ApiOperation({ summary: 'Remove a production stage.' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.stagesService.remove(user, id);
  }
}
