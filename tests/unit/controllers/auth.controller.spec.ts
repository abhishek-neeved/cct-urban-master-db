import { vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { AuthController } from '@modules/auth/auth.controller';
import type { AuthService } from '@modules/auth/auth.service';

const mockRes = () =>
  ({ status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }) as unknown as Response;
const mockReq = (body: unknown) => ({ id: 'req-1', body }) as Request;
const next = vi.fn() as NextFunction;

describe('AuthController', () => {
  it('register omits otpDevCode when the service returns no dev OTP (production)', async () => {
    const authService = {
      register: vi.fn().mockResolvedValue({ user: { id: 'u1' }, devOtp: undefined }),
    } as unknown as AuthService;
    const controller = new AuthController(authService);
    const res = mockRes();

    controller.register(mockReq({ email: 'jane.doe@example.com' }), res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.data).not.toHaveProperty('otpDevCode');
  });

  it('resendOtp includes otpDevCode when the service returns a dev OTP', async () => {
    const authService = {
      resendOtp: vi.fn().mockResolvedValue('123456'),
    } as unknown as AuthService;
    const controller = new AuthController(authService);
    const res = mockRes();

    controller.resendOtp(mockReq({ email: 'jane.doe@example.com' }), res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.data.otpDevCode).toBe('123456');
  });
});
