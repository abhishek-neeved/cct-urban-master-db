import { vi, type Mocked } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { requireAbility } from '@middleware/require-ability';
import type { IUserRepository } from '@modules/auth/user.repository';
import type { User } from '@modules/auth/user.types';
import { ForbiddenError, UnauthorizedError } from '@utils/errors';

const buildUser = (overrides: Partial<User> = {}): User => ({
  id: 'u1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  role: 'customer',
  serviceCategory: null,
  phoneNumber: null,
  isVerified: true,
  createdAt: new Date('2020-01-01'),
  updatedAt: new Date('2020-01-01'),
  ...overrides,
});

describe('requireAbility', () => {
  let users: Mocked<Pick<IUserRepository, 'findById'>>;
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    users = { findById: vi.fn() };
    next = vi.fn();
  });

  it('calls next() with no args when the role can perform the action', async () => {
    users.findById.mockResolvedValue(buildUser({ role: 'service_provider' }));
    const req = { userId: 'u1' } as Request;

    await requireAbility(users as unknown as IUserRepository, 'read', 'Kyc')(
      req,
      {} as Response,
      next as unknown as NextFunction
    );

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(ForbiddenError) when the role cannot perform the action', async () => {
    users.findById.mockResolvedValue(buildUser({ role: 'customer' }));
    const req = { userId: 'u1' } as Request;

    await requireAbility(users as unknown as IUserRepository, 'read', 'Kyc')(
      req,
      {} as Response,
      next as unknown as NextFunction
    );

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  it('calls next(ForbiddenError) when the user no longer exists', async () => {
    users.findById.mockResolvedValue(null);
    const req = { userId: 'missing' } as Request;

    await requireAbility(users as unknown as IUserRepository, 'read', 'Kyc')(
      req,
      {} as Response,
      next as unknown as NextFunction
    );

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  it('calls next(UnauthorizedError) when req.userId is missing', async () => {
    const req = {} as Request;

    await requireAbility(users as unknown as IUserRepository, 'read', 'Kyc')(
      req,
      {} as Response,
      next as unknown as NextFunction
    );

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(users.findById).not.toHaveBeenCalled();
  });
});
