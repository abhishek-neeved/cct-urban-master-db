import { vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { CriminalRecordController } from '@modules/criminal-record/criminal-record.controller';
import type { CriminalRecordService } from '@modules/criminal-record/criminal-record.service';

const mockRes = () =>
  ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  }) as unknown as Response;
const next = vi.fn() as NextFunction;

describe('CriminalRecordController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('me returns the status for the authenticated user', async () => {
    const record = { status: 'pending' as const };
    const service = { getStatus: vi.fn().mockResolvedValue(record) } as unknown as CriminalRecordService;
    const controller = new CriminalRecordController(service);
    const res = mockRes();

    controller.me({ id: 'req-1', userId: 'u1' } as Request, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(service.getStatus).toHaveBeenCalledWith('u1');
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual(record);
  });

  it('setStatus passes the target userId, status, and acting admin id to the service', async () => {
    const updated = { status: 'clear' as const, checkedAt: new Date('2020-01-01') };
    const service = { setStatus: vi.fn().mockResolvedValue(updated) } as unknown as CriminalRecordService;
    const controller = new CriminalRecordController(service);
    const res = mockRes();
    const req = {
      id: 'req-1',
      userId: 'admin1',
      params: { userId: 'u1' },
      body: { status: 'clear' },
    } as unknown as Request;

    controller.setStatus(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(service.setStatus).toHaveBeenCalledWith('u1', 'clear', 'admin1');
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual(updated);
  });
});
