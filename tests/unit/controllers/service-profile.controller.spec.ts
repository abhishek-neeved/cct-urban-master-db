import { vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { ServiceProfileController } from '@modules/service-profile/service-profile.controller';
import type { ServiceProfileService } from '@modules/service-profile/service-profile.service';

const mockRes = () =>
  ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  }) as unknown as Response;
const next = vi.fn() as NextFunction;

describe('ServiceProfileController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('me returns the profile for the authenticated user', async () => {
    const profile = { category: 'plumber' as const, description: null, yearsOfExperience: null };
    const service = {
      getProfile: vi.fn().mockResolvedValue(profile),
    } as unknown as ServiceProfileService;
    const controller = new ServiceProfileController(service);
    const res = mockRes();

    controller.me({ id: 'req-1', userId: 'u1' } as Request, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(service.getProfile).toHaveBeenCalledWith('u1');
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual({ profile });
  });

  it('upsert passes the request body through to the service', async () => {
    const profile = {
      category: 'electrician' as const,
      description: 'Wiring',
      yearsOfExperience: 5,
    };
    const service = {
      upsertProfile: vi.fn().mockResolvedValue(profile),
    } as unknown as ServiceProfileService;
    const controller = new ServiceProfileController(service);
    const res = mockRes();
    const req = {
      id: 'req-1',
      userId: 'u1',
      body: { category: 'electrician', description: 'Wiring', yearsOfExperience: 5 },
    } as unknown as Request;

    controller.upsert(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(service.upsertProfile).toHaveBeenCalledWith('u1', req.body);
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual({ profile });
  });
});
