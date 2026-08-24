import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CreatePayrollPeriodDto, QueryPayrollPeriodsDto } from './dto/payroll-period.dto';
import { PayrollPeriodsService } from './payroll-periods.service';

@ApiTags('hr')
@Controller({ path: 'payroll-periods', version: '1' })
export class PayrollPeriodsController {
  constructor(private readonly service: PayrollPeriodsService) {}

  @Post()
  @RequirePermissions('payroll-periods:manage')
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreatePayrollPeriodDto) {
    return this.service.create(user, dto);
  }

  @Get()
  @RequirePermissions('payroll-periods:manage')
  async query(@CurrentUser() user: RequestUser, @Query() query: QueryPayrollPeriodsDto) {
    return this.service.query(user, query);
  }

  @Get(':id')
  @RequirePermissions('payroll-periods:manage')
  async findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.findOne(user, id);
  }

  @Post(':id/close')
  @RequirePermissions('payroll-periods:manage')
  async close(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.close(user, id);
  }

  @Post(':id/reopen')
  @RequirePermissions('payroll-periods:manage')
  async reopen(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.service.reopen(user, id);
  }
}
