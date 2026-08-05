import { listRoles, createRole, updateRole, deleteRole, getPermissionsCatalogue } from './roles';
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

describe('getPermissionsCatalogue', () => {
  it('is a plain GET', async () => {
    (mockedApiClient.get as jest.Mock).mockResolvedValue([]);
    await getPermissionsCatalogue();
    expect(mockedApiClient.get).toHaveBeenCalledWith('roles/permissions-catalogue');
  });
});

describe('listRoles', () => {
  it('is a plain GET', async () => {
    (mockedApiClient.get as jest.Mock).mockResolvedValue([]);
    await listRoles();
    expect(mockedApiClient.get).toHaveBeenCalledWith('roles');
  });
});

describe('createRole', () => {
  it('posts name/description/permissionKeys', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ id: 'role1' });
    await createRole({ name: 'Custom', permissionKeys: ['products:read'] });
    expect(mockedApiClient.post).toHaveBeenCalledWith('roles', { name: 'Custom', permissionKeys: ['products:read'] });
  });
});

describe('updateRole', () => {
  it('is a PATCH to roles/:id', async () => {
    (mockedApiClient.patch as jest.Mock).mockResolvedValue({ id: 'role1' });
    await updateRole('role1', { permissionKeys: ['products:read', 'stock:read'] });
    expect(mockedApiClient.patch).toHaveBeenCalledWith('roles/role1', { permissionKeys: ['products:read', 'stock:read'] });
  });
});

describe('deleteRole', () => {
  it('is a DELETE to roles/:id', async () => {
    (mockedApiClient.delete as jest.Mock).mockResolvedValue({ id: 'role1', deleted: true });
    await deleteRole('role1');
    expect(mockedApiClient.delete).toHaveBeenCalledWith('roles/role1');
  });
});
