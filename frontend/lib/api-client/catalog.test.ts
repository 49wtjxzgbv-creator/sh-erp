import { importProducts, exportProducts } from './catalog';
import { apiClient } from './http';

jest.mock('./http', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    postFile: jest.fn(),
    getBlob: jest.fn(),
  },
}));

const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

afterEach(() => jest.resetAllMocks());

describe('importProducts', () => {
  it('uploads via postFile — a real multipart request, not JSON — to products/import, with updateQuantities defaulting to false', async () => {
    const file = new File(['x'], 'products.xlsx');
    (mockedApiClient.postFile as jest.Mock).mockResolvedValue({ created: 1, updated: 0, errors: [] });

    const result = await importProducts(file);

    expect(mockedApiClient.postFile).toHaveBeenCalledWith('products/import?updateQuantities=false', file);
    expect(result).toEqual({ created: 1, updated: 0, errors: [] });
  });

  it('passes updateQuantities=true through to the query string when explicitly opted in', async () => {
    const file = new File(['x'], 'products.xlsx');
    (mockedApiClient.postFile as jest.Mock).mockResolvedValue({ created: 0, updated: 1, errors: [] });

    await importProducts(file, true);

    expect(mockedApiClient.postFile).toHaveBeenCalledWith('products/import?updateQuantities=true', file);
  });
});

describe('exportProducts', () => {
  it('downloads via getBlob — a binary response, not JSON — from products/export', async () => {
    const blob = new Blob(['fake xlsx bytes']);
    (mockedApiClient.getBlob as jest.Mock).mockResolvedValue(blob);

    const result = await exportProducts();

    expect(mockedApiClient.getBlob).toHaveBeenCalledWith('products/export');
    expect(result).toBe(blob);
  });
});
