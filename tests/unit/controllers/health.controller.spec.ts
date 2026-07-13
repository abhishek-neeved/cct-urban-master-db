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

  it('live() reports the process is up with an uptime', () => {
    const res = mockRes();
    controller.live(req, res);
    expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ status: 'ok', uptime: expect.any(Number) }),
      })
    );
  });

  it('ready() → 200 when the database is connected', () => {
    isDatabaseConnected.mockReturnValue(true);
    const res = mockRes();
    controller.ready(req, res);
    expect(res.status).toHaveBeenCalledWith(StatusCodes.OK);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ready', db: 'up' }) })
    );
  });

  it('ready() → 503 when the database is unavailable', () => {
    isDatabaseConnected.mockReturnValue(false);
    const res = mockRes();
    controller.ready(req, res);
    expect(res.status).toHaveBeenCalledWith(StatusCodes.SERVICE_UNAVAILABLE);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ message: 'Service not ready: database unavailable' }),
      })
    );
  });
});
