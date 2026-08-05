import { classifyHistoryRow } from './history-classify';

describe('classifyHistoryRow', () => {
  it.each([
    ['Прихід', 'RECEIVE'],
    ['Видача', 'ISSUE'],
    ['Списання браку', 'DEFECT_WRITE_OFF'],
    ['Коригування', 'ADJUST'],
    ['Переміщення', 'MOVE'],
    ['Списання на виріб', 'PRODUCTION_CONSUMPTION'],
  ])('classifies "%s" as a %s StockMovement when Article is present', (action, movementType) => {
    const result = classifyHistoryRow({ action, article: 'ART-1', qty: 5 });
    expect(result).toEqual({ kind: 'STOCK_MOVEMENT', movementType });
  });

  it('classifies product creation with a nonzero qty as a RECEIVE movement', () => {
    const result = classifyHistoryRow({ action: 'Створення товару', article: 'ART-1', qty: 10 });
    expect(result).toEqual({ kind: 'STOCK_MOVEMENT', movementType: 'RECEIVE' });
  });

  it('downgrades product creation with a zero initial qty to AuditEvent', () => {
    const result = classifyHistoryRow({ action: 'Створення товару', article: 'ART-1', qty: 0 });
    expect(result.kind).toBe('AUDIT_EVENT');
  });

  it('downgrades a stock-affecting action with a blank Article to AuditEvent, never throwing', () => {
    const result = classifyHistoryRow({ action: 'Прихід', article: '', qty: 5 });
    expect(result.kind).toBe('AUDIT_EVENT');
    if (result.kind === 'AUDIT_EVENT') expect(result.reason).toContain('resolvable Article');
  });

  it('falls through to AuditEvent for every non-stock action label, preserving no assumption about the text', () => {
    const nonStockActions = [
      'Редагування товару', 'Видалення товару', 'Імпорт Excel', 'Інвентаризація розпочата',
      'Інвентаризація завершена', 'Замовлення постачальнику', 'Статус замовлення змінено',
      'Замовлення клієнта створено', 'Використано готовий виріб як компонент',
      'Заплановано виріб', 'Запуск виробу в роботу', 'Скасовано замовлення на виріб',
      'Контроль якості', 'Відвантаження створено', 'Аванс', 'Премія', 'Штраф',
      'Етап виробництва змінено', 'Something completely unrecognized',
    ];
    for (const action of nonStockActions) {
      expect(classifyHistoryRow({ action, article: 'ART-1', qty: 5 }).kind).toBe('AUDIT_EVENT');
    }
  });
});
