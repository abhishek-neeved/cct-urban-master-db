import { vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { AuthController } from '@modules/auth/auth.controller';
import type { AuthService } from '@modules/auth/auth.service';

const mockRes = () =>
  ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    cookie: vi.fn().mockReturnThis(),
    clearCookie: vi.fn().mockReturnThis(),
  }) as unknown as Response;
const mockReq = (body: unknown, cookies: Record<string, string> = {}) =>
  ({ id: 'req-1', body, cookies }) as Request;
const next = vi.fn() as NextFunction;

describe('AuthController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it('login sets both auth cookies alongside the JSON tokens', async () => {
    const tokens = { accessToken: 'access-1', refreshToken: 'refresh-1' };
    const authService = {
      login: vi.fn().mockResolvedValue({ user: { id: 'u1' }, tokens }),
    } as unknown as AuthService;
    const controller = new AuthController(authService);
    const res = mockRes();

    controller.login(mockReq({ email: 'jane.doe@example.com', password: 'x' }), res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(res.cookie).toHaveBeenCalledWith('accessToken', 'access-1', expect.any(Object));
    expect(res.cookie).toHaveBeenCalledWith('refreshToken', 'refresh-1', expect.any(Object));
  });

  it('refresh reads the refresh token from the cookie when present, ignoring the body', async () => {
    const tokens = { accessToken: 'access-2', refreshToken: 'refresh-2' };
    const authService = { refresh: vi.fn().mockResolvedValue(tokens) } as unknown as AuthService;
    const controller = new AuthController(authService);
    const res = mockRes();

    controller.refresh(
      mockReq({ refreshToken: 'from-body' }, { refreshToken: 'from-cookie' }),
      res,
      next
    );
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(authService.refresh).toHaveBeenCalledWith('from-cookie');
    expect(res.cookie).toHaveBeenCalledWith('accessToken', 'access-2', expect.any(Object));
  });

  it('refresh falls back to the body when no cookie is present', async () => {
    const tokens = { accessToken: 'access-3', refreshToken: 'refresh-3' };
    const authService = { refresh: vi.fn().mockResolvedValue(tokens) } as unknown as AuthService;
    const controller = new AuthController(authService);
    const res = mockRes();

    controller.refresh(mockReq({ refreshToken: 'from-body' }), res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(authService.refresh).toHaveBeenCalledWith('from-body');
  });

  it('refresh rejects with 401 when neither a cookie nor the body has a refresh token', async () => {
    const authService = { refresh: vi.fn() } as unknown as AuthService;
    const controller = new AuthController(authService);
    const res = mockRes();

    controller.refresh(mockReq({}), res, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());

    expect(authService.refresh).not.toHaveBeenCalled();
    expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      statusCode: 401,
    });
  });

  it('logout reads the refresh token from the cookie and clears both cookies', async () => {
    const authService = { logout: vi.fn().mockResolvedValue(undefined) } as unknown as AuthService;
    const controller = new AuthController(authService);
    const res = mockRes();

    controller.logout(mockReq({}, { refreshToken: 'from-cookie' }), res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(authService.logout).toHaveBeenCalledWith('from-cookie');
    expect(res.clearCookie).toHaveBeenCalledWith('accessToken', expect.any(Object));
    expect(res.clearCookie).toHaveBeenCalledWith('refreshToken', expect.any(Object));
  });
});
