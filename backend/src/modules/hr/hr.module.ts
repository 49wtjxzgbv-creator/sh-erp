import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { PayrollController } from './payroll.controller';
import { PayrollPeriodsController } from './payroll-periods.controller';
import { PayrollPeriodsService } from './payroll-periods.service';
import { PayrollService } from './payroll.service';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

@Module({
  controllers: [EmployeesController, PayrollController, TeamsController, PayrollPeriodsController],
  providers: [EmployeesService, PayrollService, TeamsService, PayrollPeriodsService],
  exports: [EmployeesService, PayrollService, TeamsService, PayrollPeriodsService],
})
export class HrModule {}
