import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { QueryFinishedGoodsDto } from './dto/finished-goods.dto';
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

  @Get(':id')
  @RequirePermissions('finished-goods:read')
  @ApiOperation({ summary: 'Get one finished good by id.' })
  async findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.finishedGoodsService.findOne(user, id);
  }
}
