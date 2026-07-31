import { vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { KycController } from '@modules/kyc/kyc.controller';
import type { KycService } from '@modules/kyc/kyc.service';

const mockRes = () =>
  ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  }) as unknown as Response;
const next = vi.fn() as NextFunction;

describe('KycController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('me returns the status for the authenticated user', async () => {
    const record = { status: 'not_started' as const };
    const kycService = { getStatus: vi.fn().mockResolvedValue(record) } as unknown as KycService;
    const controller = new KycController(kycService);
    const res = mockRes();

    controller.me({ id: 'req-1', userId: 'u1' } as Request, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(kycService.getStatus).toHaveBeenCalledWith('u1');
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual(record);
  });

  it('submit converts an empty-string uan to undefined before calling the service', async () => {
    const kycService = {
      submit: vi.fn().mockResolvedValue({ status: 'pending' }),
    } as unknown as KycService;
    const controller = new KycController(kycService);
    const res = mockRes();
    const req = {
      id: 'req-1',
      userId: 'u1',
      body: { aadharNumber: '123456789012', uan: '' },
    } as unknown as Request;

    controller.submit(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(kycService.submit).toHaveBeenCalledWith('u1', {
      aadharNumber: '123456789012',
      uan: undefined,
    });
  });

  it('submit passes a non-empty uan through unchanged', async () => {
    const kycService = {
      submit: vi.fn().mockResolvedValue({ status: 'pending' }),
    } as unknown as KycService;
    const controller = new KycController(kycService);
    const res = mockRes();
    const req = {
      id: 'req-1',
      userId: 'u1',
      body: { aadharNumber: '123456789012', uan: '12345678901234' },
    } as unknown as Request;

    controller.submit(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(kycService.submit).toHaveBeenCalledWith('u1', {
      aadharNumber: '123456789012',
      uan: '12345678901234',
    });
  });

  it('listForReview passes the status query through to the service', async () => {
    const kycService = {
      listForReview: vi.fn().mockResolvedValue([{ id: 'kyc1' }]),
    } as unknown as KycService;
    const controller = new KycController(kycService);
    const res = mockRes();
    const req = { id: 'req-1', userId: 'admin1', query: { status: 'pending' } } as unknown as Request;

    controller.listForReview(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(kycService.listForReview).toHaveBeenCalledWith('pending');
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual({
      records: [{ id: 'kyc1' }],
    });
  });

  it('listForReview passes undefined when no status filter is given', async () => {
    const kycService = { listForReview: vi.fn().mockResolvedValue([]) } as unknown as KycService;
    const controller = new KycController(kycService);
    const res = mockRes();
    const req = { id: 'req-1', userId: 'admin1', query: {} } as unknown as Request;

    controller.listForReview(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(kycService.listForReview).toHaveBeenCalledWith(undefined);
  });

  it('approve passes the target userId and the acting admin id to the service', async () => {
    const approved = { id: 'kyc1', status: 'verified' };
    const kycService = { approve: vi.fn().mockResolvedValue(approved) } as unknown as KycService;
    const controller = new KycController(kycService);
    const res = mockRes();
    const req = { id: 'req-1', userId: 'admin1', params: { userId: 'u1' } } as unknown as Request;

    controller.approve(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(kycService.approve).toHaveBeenCalledWith('u1', 'admin1');
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual(approved);
  });

  it('reject passes the target userId, the acting admin id, and the reason to the service', async () => {
    const rejected = { id: 'kyc1', status: 'rejected' };
    const kycService = { reject: vi.fn().mockResolvedValue(rejected) } as unknown as KycService;
    const controller = new KycController(kycService);
    const res = mockRes();
    const req = {
      id: 'req-1',
      userId: 'admin1',
      params: { userId: 'u1' },
      body: { reason: 'blurry photo' },
    } as unknown as Request;

    controller.reject(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(kycService.reject).toHaveBeenCalledWith('u1', 'admin1', 'blurry photo');
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual(rejected);
  });
});
