import { rowsToWorkers, workersToRows } from './worker-editor';

describe('rowsToWorkers', () => {
  it('converts valid rows to ProductionOrderWorkerInput[]', () => {
    const rows = workersToRows([{ employeeId: 'e1', percent: 60 }, { employeeId: 'e2', percent: 40 }]);
    expect(rowsToWorkers(rows)).toEqual([
      { employeeId: 'e1', percent: 60 },
      { employeeId: 'e2', percent: 40 },
    ]);
  });

  it('returns null if any row is missing an employee', () => {
    const rows = [{ key: 'r1', employeeId: undefined, percent: '50' }];
    expect(rowsToWorkers(rows)).toBeNull();
  });

  it('returns null if any row has a zero or blank percent', () => {
    const rows = [{ key: 'r1', employeeId: 'e1', percent: '0' }];
    expect(rowsToWorkers(rows)).toBeNull();
  });

  it('does not require percentages to sum to 100 — normalization happens server-side at start()', () => {
    const rows = [
      { key: 'r1', employeeId: 'e1', percent: '30' },
      { key: 'r2', employeeId: 'e2', percent: '30' },
    ];
    expect(rowsToWorkers(rows)).toEqual([
      { employeeId: 'e1', percent: 30 },
      { employeeId: 'e2', percent: 30 },
    ]);
  });
});
