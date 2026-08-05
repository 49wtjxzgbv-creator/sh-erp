import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';

@Module({
  controllers: [EmployeesController, PayrollController],
  providers: [EmployeesService, PayrollService],
  exports: [EmployeesService, PayrollService],
})
export class HrModule {}
