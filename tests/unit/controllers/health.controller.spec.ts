import { vi } from 'vitest';
import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

const { isDatabaseConnected } = vi.hoisted(() => ({ isDatabaseConnected: vi.fn() }));
vi.mock('@config/database', () => ({ isDatabaseConnected }));

const { HealthController } = await import('@modules/health/health.controller');

const mockRes = () =>
  ({ status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }) as unknown as Response;
const req = { id: 'req-1' } as Request;

describe('HealthController', () => {
  const controller = new HealthController();

  it('check() → 200 with ok: 1 when the database is connected', () => {
    isDatabaseConnected.mockReturnValue(true);
    const res = mockRes();
    controller.check(req, res);
    expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ ok: 1, db: 'up', uptime: expect.any(Number) }),
      })
    );
  });

  it('check() → 503 with ok: -1 when the database is unavailable', () => {
    isDatabaseConnected.mockReturnValue(false);
    const res = mockRes();
    controller.check(req, res);
    expect(res.status).toHaveBeenCalledWith(StatusCodes.SERVICE_UNAVAILABLE);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          message: 'Service unhealthy: database unavailable',
          details: expect.objectContaining({ ok: -1, db: 'down' }),
        }),
      })
    );
  });
});
