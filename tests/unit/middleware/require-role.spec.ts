import { vi, type Mocked } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireRole } from '@middleware/require-role';
import type { IUserRepository } from '@modules/auth/user.repository';
import type { User } from '@modules/auth/user.types';
import { ForbiddenError, UnauthorizedError } from '@utils/errors';

const buildUser = (overrides: Partial<User> = {}): User => ({
  id: 'u1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  role: 'user',
  isVerified: true,
  createdAt: new Date('2020-01-01'),
  updatedAt: new Date('2020-01-01'),
  ...overrides,
});

describe('requireRole', () => {
  let users: Mocked<Pick<IUserRepository, 'findById'>>;
  const next = vi.fn() as NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    users = { findById: vi.fn() };
  });

  it('calls next() with no error when the user has an allowed role', async () => {
    users.findById.mockResolvedValue(buildUser({ role: 'admin' }));
    const middleware = requireRole(users as unknown as IUserRepository, 'admin');

    await middleware({ userId: 'u1' } as Request, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('rejects with ForbiddenError when the user has a disallowed role', async () => {
    users.findById.mockResolvedValue(buildUser({ role: 'user' }));
    const middleware = requireRole(users as unknown as IUserRepository, 'admin');

    await middleware({ userId: 'u1' } as Request, {} as Response, next);

    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(ForbiddenError);
  });

  it('rejects with ForbiddenError when the user no longer exists', async () => {
    users.findById.mockResolvedValue(null);
    const middleware = requireRole(users as unknown as IUserRepository, 'admin');

    await middleware({ userId: 'missing' } as Request, {} as Response, next);

    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(ForbiddenError);
  });

  it('rejects with UnauthorizedError when req.userId is missing (requireAuth did not run)', async () => {
    const middleware = requireRole(users as unknown as IUserRepository, 'admin');

    await middleware({} as Request, {} as Response, next);

    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
    expect(users.findById).not.toHaveBeenCalled();
  });
});
