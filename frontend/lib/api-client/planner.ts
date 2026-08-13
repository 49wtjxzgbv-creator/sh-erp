import { apiClient } from './http';

/**
 * Typed wrappers for backend/src/modules/planner/ — a pure read/compute
 * layer over real entities (CustomerOrder → CustomerOrderItem →
 * ProductionOrder batch → ProductionOrderStagePlan), never its own storage.
 * Field shapes copied verbatim from planner-board.service.ts/
 * planner-conflicts.service.ts/planner-kpis.service.ts.
 */

export type PlannerProblemSeverity = 'critical' | 'warning' | 'info';

export interface PlannerProblem {
  severity: PlannerProblemSeverity;
  code: string;
  message: string;
  entityType: 'CustomerOrder' | 'CustomerOrderItem' | 'ProductionOrder' | 'PurchaseOrder' | 'FinishedGood' | 'Employee';
  entityId: string;
  orderId: string;
}

export interface PlannerStageNode {
  id: string;
  name: string;
  sortOrder: number;
  /** null = "Етап не запланований" — never a guessed date. */
  plan: { startAt: string | null; endAt: string | null } | null;
  /** Derived from real ProductionOrderStageEvent transitions — startAt is the previous stage's completion (null for the very first stage, genuinely unrecorded), endAt is null while this stage hasn't been left yet (still in progress or not reached). */
  fact: { startAt: string | null; endAt: string | null };
}

export interface PlannerBatchNode {
  id: string;
  unitsPlanned: number;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  currentStageIndex: number | null;
  plan: { startAt: string | null; endAt: string | null };
  fact: { startAt: string | null; endAt: string | null };
  stages: PlannerStageNode[];
  workers: { employeeId: string; employeeName: string }[];
  problems: PlannerProblem[];
}

export interface PlannerItemQuantitySummary {
  ordered: number;
  inProduction: number;
  completed: number;
  remaining: number;
}

export interface PlannerItemNode {
  id: string;
  assemblyId: string;
  assemblyName: string;
  article: string | null;
  qty: number;
  plan: { startAt: string | null; endAt: string | null; deadline: string | null };
  quantitySummary: PlannerItemQuantitySummary;
  batches: PlannerBatchNode[];
  problems: PlannerProblem[];
}

export interface PlannerPurchaseOrderRef {
  id: string;
  supplierId: string | null;
  supplierName: string;
  status: 'ORDERED' | 'PARTIAL' | 'DELIVERED';
  expectedDeliveryDate: string | null;
  orderDate: string;
}

export interface PlannerShipmentRef {
  id: string;
  status: 'SHIPPED' | 'DELIVERED';
  shipDate: string | null;
  deliveryDate: string | null;
}

export interface PlannerOrderNode {
  id: string;
  orderNumber: string | null;
  clientName: string;
  status: 'NEW' | 'IN_PRODUCTION' | 'COMPLETED' | 'CANCELLED';
  deadline: string | null;
  plan: { startAt: string | null; completionAt: string | null; shipmentAt: string | null; deliveryAt: string | null };
  items: PlannerItemNode[];
  purchaseOrders: PlannerPurchaseOrderRef[];
  /** A row only ever exists once actually shipped — its presence here is itself the fact signal (План-графік §"Відвантаження"). */
  shipments: PlannerShipmentRef[];
  riskLevel: 'none' | 'warning' | 'critical';
  problemCount: number;
}

export interface PlannerBoard {
  from: string;
  to: string;
  orders: PlannerOrderNode[];
  problems: PlannerProblem[];
}

export interface QueryPlannerBoardInput {
  from?: string;
  to?: string;
  orderId?: string;
  itemId?: string;
  batchId?: string;
  stageId?: string;
  supplierId?: string;
  responsibleId?: string;
  status?: string;
  problem?: 'true' | 'false';
  search?: string;
}

export interface PlannerKpis {
  ordersInWork: number;
  itemsInWork: number;
  batchesInWork: number;
  stagesInWork: number;
  itemsWithProblems: number;
  itemsBlockedByMaterials: number;
  overduePurchases: number;
  ordersAtRisk: number;
  finishedGoodsAwaitingShipment: number;
}

export function getPlannerBoard(query: QueryPlannerBoardInput = {}): Promise<PlannerBoard> {
  return apiClient.get<PlannerBoard>('planner/board', { query: query as Record<string, string> });
}
export function getPlannerKpis(query: QueryPlannerBoardInput = {}): Promise<PlannerKpis> {
  return apiClient.get<PlannerKpis>('planner/kpis', { query: query as Record<string, string> });
}
