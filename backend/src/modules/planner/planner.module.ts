import { Module } from '@nestjs/common';
import { PlannerController } from './planner.controller';
import { PlannerBoardService } from './planner-board.service';
import { PlannerConflictsService } from './planner-conflicts.service';
import { PlannerKpisService } from './planner-kpis.service';

@Module({
  controllers: [PlannerController],
  providers: [PlannerBoardService, PlannerConflictsService, PlannerKpisService],
})
export class PlannerModule {}
