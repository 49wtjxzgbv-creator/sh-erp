import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CreateEmployeeDto, QueryEmployeesDto, UpdateEmployeeDto } from './dto/employee.dto';
import { EmployeesService } from './employees.service';

@ApiTags('hr')
@Controller({ path: 'employees', version: '1' })
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Post()
  @RequirePermissions('employees:manage')
  @ApiOperation({ summary: 'Create an employee.' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateEmployeeDto) {
    return this.employeesService.create(user, dto);
  }

  @Get()
  @RequirePermissions('employees:manage')
  @ApiOperation({ summary: 'Search/list employees, paginated. Defaults to ACTIVE only.' })
  async query(@CurrentUser() user: RequestUser, @Query() query: QueryEmployeesDto) {
    return this.employeesService.query(user, query);
  }

  @Get(':id')
  @RequirePermissions('employees:manage')
  @ApiOperation({ summary: 'Get one employee.' })
  async findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.employeesService.findOne(user, id);
  }

  @Patch(':id')
  @RequirePermissions('employees:manage')
  @ApiOperation({ summary: 'Update an employee.' })
  async update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employeesService.update(user, id, dto);
  }

  @Post(':id/deactivate')
  @RequirePermissions('employees:manage')
  @ApiOperation({ summary: 'Deactivate an employee — never hard-deleted, preserves payroll linkage (Phase 1 §3.5).' })
  async deactivate(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.employeesService.deactivate(user, id);
  }

  @Post(':id/reactivate')
  @RequirePermissions('employees:manage')
  @ApiOperation({ summary: 'Reactivate a previously deactivated employee.' })
  async reactivate(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.employeesService.reactivate(user, id);
  }
}
