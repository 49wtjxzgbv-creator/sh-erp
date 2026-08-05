import { deactivateEmployee, reactivateEmployee, updateEmployee, recordPayrollEntry, getPayrollSummary, queryEmployees } from './hr';
import { apiClient } from './http';

jest.mock('./http', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

afterEach(() => jest.resetAllMocks());

describe('deactivateEmployee / reactivateEmployee', () => {
  it('posts to employees/:id/deactivate and /reactivate with no body — never a hard delete', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ id: 'e1', status: 'INACTIVE' });
    await deactivateEmployee('e1');
    expect(mockedApiClient.post).toHaveBeenCalledWith('employees/e1/deactivate');

    (mockedApiClient.post as jest.Mock).mockResolvedValue({ id: 'e1', status: 'ACTIVE' });
    await reactivateEmployee('e1');
    expect(mockedApiClient.post).toHaveBeenCalledWith('employees/e1/reactivate');
  });
});

describe('updateEmployee', () => {
  it('PATCHes a partial payload, not PUT', async () => {
    (mockedApiClient.patch as jest.Mock).mockResolvedValue({ id: 'e1' });
    await updateEmployee('e1', { position: 'Assembler' });
    expect(mockedApiClient.patch).toHaveBeenCalledWith('employees/e1', { position: 'Assembler' });
    expect(mockedApiClient.put).not.toHaveBeenCalled();
  });
});

describe('recordPayrollEntry', () => {
  it('posts to payroll/entries with a positive magnitude — the backend applies the sign, not this client', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ id: 'p1', type: 'PENALTY', amount: '-50.00' });
    await recordPayrollEntry({ employeeId: 'e1', type: 'PENALTY', amount: 50 });
    expect(mockedApiClient.post).toHaveBeenCalledWith('payroll/entries', { employeeId: 'e1', type: 'PENALTY', amount: 50 });
  });
});

describe('getPayrollSummary', () => {
  it('is a GET, not a POST — the summary report has no side effects', async () => {
    (mockedApiClient.get as jest.Mock).mockResolvedValue([]);
    await getPayrollSummary({ from: '2026-01-01' });
    expect(mockedApiClient.get).toHaveBeenCalledWith('payroll/summary', { query: { from: '2026-01-01' } });
    expect(mockedApiClient.post).not.toHaveBeenCalled();
  });
});

describe('queryEmployees', () => {
  it('is a GET — searching employees has no side effects', async () => {
    (mockedApiClient.get as jest.Mock).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    await queryEmployees({ status: 'ACTIVE' });
    expect(mockedApiClient.get).toHaveBeenCalledWith('employees', { query: { status: 'ACTIVE' } });
  });
});
