import { setAssemblyComponents, produceAssembly, calculateAssemblyCost } from './bom';
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

describe('setAssemblyComponents', () => {
  it('PUTs the full component list to assemblies/:id/components, wrapped in {components}', async () => {
    (mockedApiClient.put as jest.Mock).mockResolvedValue({ version: {}, components: [] });
    await setAssemblyComponents('a1', [{ componentType: 'PRODUCT', productId: 'p1', qtyPerUnit: 2 }]);
    expect(mockedApiClient.put).toHaveBeenCalledWith('assemblies/a1/components', {
      components: [{ componentType: 'PRODUCT', productId: 'p1', qtyPerUnit: 2 }],
    });
  });
});

describe('produceAssembly', () => {
  it('posts to assemblies/:id/produce with the qty/warehouseId/comment shape', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ assemblyId: 'a1' });
    await produceAssembly('a1', { qty: 5, warehouseId: 'w1' });
    expect(mockedApiClient.post).toHaveBeenCalledWith('assemblies/a1/produce', { qty: 5, warehouseId: 'w1' });
  });
});

describe('calculateAssemblyCost', () => {
  it('is a GET, not a POST — cost calculation has no side effects', async () => {
    (mockedApiClient.get as jest.Mock).mockResolvedValue({ assemblyId: 'a1', localCostPerUnit: 10, germanCostPerUnit: 12, breakdown: [] });
    await calculateAssemblyCost('a1');
    expect(mockedApiClient.get).toHaveBeenCalledWith('assemblies/a1/cost');
    expect(mockedApiClient.post).not.toHaveBeenCalled();
  });
});
