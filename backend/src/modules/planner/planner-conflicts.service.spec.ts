import { PlannerConflictsService } from './planner-conflicts.service';

describe('PlannerConflictsService', () => {
  let service: PlannerConflictsService;
  const now = new Date('2026-08-28T00:00:00.000Z');
  const past = new Date('2026-08-01T00:00:00.000Z');
  const future = new Date('2026-09-15T00:00:00.000Z');

  const baseItem = {
    id: 'item1',
    assemblyName: 'Виріб',
    itemLabel: 'Виріб × 1',
    qty: 1,
    itemDeadline: null,
    plannedStartAt: null,
    plannedEndAt: null,
    orderId: 'order1',
    orderDeadline: null,
    orderPlannedStartAt: null,
    orderPlannedCompletionAt: null,
    batches: [] as any[],
  };

  beforeEach(() => {
    service = new PlannerConflictsService();
  });

  describe('checkStartOverdue (2026-08-28 user request — "почалось замовлення а ми ще не дали в роботу")', () => {
    it('returns null when there is no planned start at either level', () => {
      expect(service.checkStartOverdue({ ...baseItem }, now)).toBeNull();
    });

    it('returns null when the planned start is still in the future', () => {
      expect(service.checkStartOverdue({ ...baseItem, plannedStartAt: future }, now)).toBeNull();
    });

    it('returns a warning when the item\'s own planned start has passed and nothing was given to production', () => {
      const result = service.checkStartOverdue({ ...baseItem, plannedStartAt: past }, now);
      expect(result).toEqual(expect.objectContaining({ severity: 'warning', code: 'START_OVERDUE', entityType: 'CustomerOrderItem', entityId: 'item1', orderId: 'order1' }));
    });

    it('falls back to the order\'s planned start when the item has none of its own', () => {
      const result = service.checkStartOverdue({ ...baseItem, orderPlannedStartAt: past }, now);
      expect(result?.code).toBe('START_OVERDUE');
    });

    it('prefers the item\'s own planned start over the order\'s when both are set', () => {
      // Item's own start is in the future -> not overdue, even though the order's is in the past.
      expect(service.checkStartOverdue({ ...baseItem, plannedStartAt: future, orderPlannedStartAt: past }, now)).toBeNull();
    });

    it('returns null once at least one batch was actually given to production, regardless of status', () => {
      const result = service.checkStartOverdue(
        { ...baseItem, plannedStartAt: past, batches: [{ id: 'b1', unitsPlanned: 1, status: 'PLANNED', scheduledStartAt: null, scheduledEndAt: null, assemblyId: 'a1', bomLines: [], workers: [] }] },
        now,
      );
      expect(result).toBeNull();
    });

    it('still flags when every batch that existed was cancelled — cancelling is not the same as starting', () => {
      const result = service.checkStartOverdue(
        { ...baseItem, plannedStartAt: past, batches: [{ id: 'b1', unitsPlanned: 1, status: 'CANCELLED', scheduledStartAt: null, scheduledEndAt: null, assemblyId: 'a1', bomLines: [], workers: [] }] },
        now,
      );
      expect(result?.code).toBe('START_OVERDUE');
    });
  });

  describe('checkCompletionOverdue (2026-08-28 user request — "маємо завершити а ще не завершили")', () => {
    it('returns null when there is no planned completion at either level', () => {
      expect(service.checkCompletionOverdue({ ...baseItem }, now)).toBeNull();
    });

    it('returns null when the planned completion is still in the future', () => {
      expect(service.checkCompletionOverdue({ ...baseItem, plannedEndAt: future }, now)).toBeNull();
    });

    it('returns a warning when the planned completion has passed and nothing was ever started', () => {
      const result = service.checkCompletionOverdue({ ...baseItem, plannedEndAt: past }, now);
      expect(result).toEqual(expect.objectContaining({ severity: 'warning', code: 'COMPLETION_OVERDUE', entityType: 'CustomerOrderItem', entityId: 'item1' }));
    });

    it('returns a warning when a batch is still PLANNED past the planned completion date', () => {
      const result = service.checkCompletionOverdue(
        { ...baseItem, plannedEndAt: past, batches: [{ id: 'b1', unitsPlanned: 1, status: 'PLANNED', scheduledStartAt: null, scheduledEndAt: null, assemblyId: 'a1', bomLines: [], workers: [] }] },
        now,
      );
      expect(result?.code).toBe('COMPLETION_OVERDUE');
    });

    it('returns a warning when a batch is still IN_PROGRESS past the planned completion date', () => {
      const result = service.checkCompletionOverdue(
        { ...baseItem, plannedEndAt: past, batches: [{ id: 'b1', unitsPlanned: 1, status: 'IN_PROGRESS', scheduledStartAt: null, scheduledEndAt: null, assemblyId: 'a1', bomLines: [], workers: [] }] },
        now,
      );
      expect(result?.code).toBe('COMPLETION_OVERDUE');
    });

    it('returns null once every batch is COMPLETED', () => {
      const result = service.checkCompletionOverdue(
        { ...baseItem, plannedEndAt: past, batches: [{ id: 'b1', unitsPlanned: 1, status: 'COMPLETED', scheduledStartAt: null, scheduledEndAt: null, assemblyId: 'a1', bomLines: [], workers: [] }] },
        now,
      );
      expect(result).toBeNull();
    });

    it('returns null when the only batch was CANCELLED — a deliberate non-completion, not an oversight', () => {
      const result = service.checkCompletionOverdue(
        { ...baseItem, plannedEndAt: past, batches: [{ id: 'b1', unitsPlanned: 1, status: 'CANCELLED', scheduledStartAt: null, scheduledEndAt: null, assemblyId: 'a1', bomLines: [], workers: [] }] },
        now,
      );
      expect(result).toBeNull();
    });

    it('falls back to the order\'s planned completion when the item has none of its own', () => {
      const result = service.checkCompletionOverdue({ ...baseItem, orderPlannedCompletionAt: past }, now);
      expect(result?.code).toBe('COMPLETION_OVERDUE');
    });
  });
});
