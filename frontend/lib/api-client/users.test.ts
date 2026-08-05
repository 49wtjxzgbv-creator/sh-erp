import { listUsers, inviteUser, updateUserRole, deactivateUser, changeOwnPassword } from './users';
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

describe('listUsers', () => {
  it('is a plain GET', async () => {
    (mockedApiClient.get as jest.Mock).mockResolvedValue([]);
    await listUsers();
    expect(mockedApiClient.get).toHaveBeenCalledWith('users');
  });
});

describe('inviteUser', () => {
  it('posts to users/invite', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ tempPassword: 'abc' });
    await inviteUser({ email: 'a@b.com', fullName: 'A B', roleId: 'r1' });
    expect(mockedApiClient.post).toHaveBeenCalledWith('users/invite', { email: 'a@b.com', fullName: 'A B', roleId: 'r1' });
  });
});

describe('updateUserRole', () => {
  it('is a PATCH to users/:userId/role', async () => {
    (mockedApiClient.patch as jest.Mock).mockResolvedValue({});
    await updateUserRole('u1', 'r2');
    expect(mockedApiClient.patch).toHaveBeenCalledWith('users/u1/role', { roleId: 'r2' });
  });
});

describe('deactivateUser', () => {
  it('is a POST — a membership removal action, not a DELETE on the global User row', async () => {
    (mockedApiClient.post as jest.Mock).mockResolvedValue({ userId: 'u1', removed: true });
    await deactivateUser('u1');
    expect(mockedApiClient.post).toHaveBeenCalledWith('users/u1/deactivate');
    expect(mockedApiClient.delete).not.toHaveBeenCalled();
  });
});

describe('changeOwnPassword', () => {
  it('is a PATCH to users/me/password', async () => {
    (mockedApiClient.patch as jest.Mock).mockResolvedValue({ changed: true });
    await changeOwnPassword({ currentPassword: 'old', newPassword: 'new-strong-password' });
    expect(mockedApiClient.patch).toHaveBeenCalledWith('users/me/password', {
      currentPassword: 'old',
      newPassword: 'new-strong-password',
    });
  });
});
