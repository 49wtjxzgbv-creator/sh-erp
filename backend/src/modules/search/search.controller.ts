import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { SearchService } from './search.service';

// No @RequirePermissions, same reasoning as DashboardController — every
// authenticated role needs to be able to search regardless of which
// specific module permissions they hold.
@ApiTags('search')
@Controller({ path: 'search', version: '1' })
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({ summary: 'Global instant search across products, assemblies, customer orders, and suppliers.' })
  async search(@CurrentUser() user: RequestUser, @Query('q') q: string) {
    return this.searchService.search(user, q ?? '');
  }
}
