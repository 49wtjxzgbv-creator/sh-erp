import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { QueryPlannerBoardDto } from './dto/planner-query.dto';
import { PlannerBoardService } from './planner-board.service';

/**
 * Derived from the same board tree PlannerBoardService already builds —
 * no separate query set, just different aggregation over the same real
 * data. Each number is clickable in the UI to filter the board itself.
 */
@Injectable()
export class PlannerKpisService {
  constructor(private readonly board: PlannerBoardService) {}

  async getKpis(user: RequestUser, query: QueryPlannerBoardDto) {
    const { orders, problems } = await this.board.getBoard(user, query);

    const ordersInWork = orders.filter((o) => o.status === 'NEW' || o.status === 'IN_PRODUCTION').length;
    const items = orders.flatMap((o) => o.items);
    const itemsInWork = items.filter((i) => i.quantitySummary.remaining > 0 || i.quantitySummary.inProduction > i.quantitySummary.completed).length;
    const batches = items.flatMap((i) => i.batches);
    const batchesInWork = batches.filter((b) => b.status === 'PLANNED' || b.status === 'IN_PROGRESS').length;
    const stagesInWork = batches.filter((b) => b.status === 'IN_PROGRESS').reduce((sum, b) => sum + (b.currentStageIndex ?? 0) + 1, 0);
    const itemsWithProblems = items.filter((i) => i.problems.length > 0).length;
    const itemsBlockedByMaterials = items.filter((i) => i.problems.some((p) => p.code === 'MATERIAL_SHORTAGE' || p.code === 'MATERIAL_LATE_FOR_START')).length;
    const overduePurchases = problems.filter((p) => p.code === 'PURCHASE_OVERDUE').length;
    const ordersAtRisk = orders.filter((o) => o.riskLevel !== 'none').length;
    const finishedGoodsAwaitingShipment = problems.filter((p) => p.code === 'FG_AWAITING_SHIPMENT').length;

    return {
      ordersInWork,
      itemsInWork,
      batchesInWork,
      stagesInWork,
      itemsWithProblems,
      itemsBlockedByMaterials,
      overduePurchases,
      ordersAtRisk,
      finishedGoodsAwaitingShipment,
    };
  }
}
