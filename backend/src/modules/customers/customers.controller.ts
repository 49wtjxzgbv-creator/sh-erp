import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { QueryCustomersDto } from './dto/query-customers.dto';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { CustomersService } from './customers.service';

@ApiTags('customers')
@Controller({ path: 'customers', version: '1' })
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @RequirePermissions('customers:write')
  @ApiOperation({ summary: 'Create a customer.' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateCustomerDto) {
    return this.customersService.create(user, dto);
  }

  @Get()
  @RequirePermissions('customers:read')
  @ApiOperation({ summary: 'Search/list customers, paginated.' })
  async query(@CurrentUser() user: RequestUser, @Query() query: QueryCustomersDto) {
    return this.customersService.query(user, query);
  }

  @Get(':id')
  @RequirePermissions('customers:read')
  @ApiOperation({ summary: 'Get one customer.' })
  async findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.customersService.findOne(user, id);
  }

  @Patch(':id')
  @RequirePermissions('customers:write')
  @ApiOperation({ summary: 'Update a customer.' })
  async update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customersService.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('customers:write')
  @ApiOperation({ summary: 'Soft-delete a customer.' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.customersService.remove(user, id);
  }
}
