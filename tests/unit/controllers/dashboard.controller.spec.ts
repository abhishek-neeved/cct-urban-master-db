import { vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { DashboardController } from '@modules/dashboard/dashboard.controller';
import type { DashboardService } from '@modules/dashboard/dashboard.service';

const mockRes = () =>
  ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  }) as unknown as Response;
const next = vi.fn() as NextFunction;

describe('DashboardController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('me returns the composed summary for the authenticated user', async () => {
    const summary = {
      user: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
      kyc: { status: 'verified' as const },
      criminalRecord: { status: 'clear' as const },
      onboardingFee: { status: 'unpaid' as const, amountInRupees: 10 },
    };
    const service = {
      getSummary: vi.fn().mockResolvedValue(summary),
    } as unknown as DashboardService;
    const controller = new DashboardController(service);
    const res = mockRes();

    controller.me({ id: 'req-1', userId: 'u1' } as Request, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(service.getSummary).toHaveBeenCalledWith('u1');
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual(summary);
  });
});
