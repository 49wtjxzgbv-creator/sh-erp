import { ApiError } from './types';

describe('ApiError', () => {
  it('joins a class-validator array message into a single string', () => {
    const err = new ApiError(
      400,
      { statusCode: 400, message: ['email must be an email', 'password must be longer than 12 characters'], error: 'Bad Request' },
      'Bad Request',
    );
    expect(err.message).toBe('email must be an email password must be longer than 12 characters');
    expect(err.status).toBe(400);
  });

  it('uses a single string message as-is', () => {
    const err = new ApiError(401, { statusCode: 401, message: 'Invalid email or password.' }, 'Unauthorized');
    expect(err.message).toBe('Invalid email or password.');
  });

  it('falls back to the HTTP status text when no body is present', () => {
    const err = new ApiError(500, undefined, 'Internal Server Error');
    expect(err.message).toBe('Internal Server Error');
  });
});
