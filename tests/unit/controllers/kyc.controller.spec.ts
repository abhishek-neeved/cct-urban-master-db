import { vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { KycController } from '@modules/kyc/kyc.controller';
import type { KycService } from '@modules/kyc/kyc.service';
import type { KycVerificationService } from '@modules/kyc/kyc-verification.service';

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
    const verificationService = {} as KycVerificationService;
    const controller = new KycController(kycService, verificationService);
    const res = mockRes();

    controller.me({ id: 'req-1', userId: 'u1' } as Request, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(kycService.getStatus).toHaveBeenCalledWith('u1');
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual(record);
  });

  it('submit passes the request body through to the service', async () => {
    const kycService = {
      submit: vi.fn().mockResolvedValue({ status: 'pending' }),
    } as unknown as KycService;
    const verificationService = {} as KycVerificationService;
    const controller = new KycController(kycService, verificationService);
    const res = mockRes();
    const req = {
      id: 'req-1',
      userId: 'u1',
      body: { aadharNumber: '123456789012', panNumber: 'ABCDE1234F', address: '221B Baker Street' },
    } as unknown as Request;

    controller.submit(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(kycService.submit).toHaveBeenCalledWith('u1', req.body);
  });

  it('requestAadharVerification passes the aadharNumber through to the verification service', async () => {
    const result = { maskedMobileNumber: '9XXXXX9012', devOtp: '042317' };
    const verificationService = {
      requestAadharVerification: vi.fn().mockResolvedValue(result),
    } as unknown as KycVerificationService;
    const controller = new KycController({} as KycService, verificationService);
    const res = mockRes();
    const req = {
      id: 'req-1',
      userId: 'u1',
      body: { aadharNumber: '123456789012' },
    } as unknown as Request;

    controller.requestAadharVerification(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(verificationService.requestAadharVerification).toHaveBeenCalledWith(
      'u1',
      '123456789012'
    );
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual(result);
  });

  it('verifyAadharOtp confirms the otp via the verification service', async () => {
    const verificationService = {
      verifyAadharOtp: vi.fn().mockResolvedValue(undefined),
    } as unknown as KycVerificationService;
    const controller = new KycController({} as KycService, verificationService);
    const res = mockRes();
    const req = { id: 'req-1', userId: 'u1', body: { otp: '042317' } } as unknown as Request;

    controller.verifyAadharOtp(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(verificationService.verifyAadharOtp).toHaveBeenCalledWith('u1', '042317');
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual({
      verified: true,
    });
  });

  it('requestPanVerification passes the panNumber through to the verification service', async () => {
    const result = { maskedMobileNumber: '9XXXXX234F', devOtp: '042317' };
    const verificationService = {
      requestPanVerification: vi.fn().mockResolvedValue(result),
    } as unknown as KycVerificationService;
    const controller = new KycController({} as KycService, verificationService);
    const res = mockRes();
    const req = {
      id: 'req-1',
      userId: 'u1',
      body: { panNumber: 'ABCDE1234F' },
    } as unknown as Request;

    controller.requestPanVerification(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(verificationService.requestPanVerification).toHaveBeenCalledWith('u1', 'ABCDE1234F');
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual(result);
  });

  it('verifyPanOtp confirms the otp via the verification service', async () => {
    const verificationService = {
      verifyPanOtp: vi.fn().mockResolvedValue(undefined),
    } as unknown as KycVerificationService;
    const controller = new KycController({} as KycService, verificationService);
    const res = mockRes();
    const req = { id: 'req-1', userId: 'u1', body: { otp: '042317' } } as unknown as Request;

    controller.verifyPanOtp(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(verificationService.verifyPanOtp).toHaveBeenCalledWith('u1', '042317');
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual({
      verified: true,
    });
  });

  it('listForReview passes the status query through to the service', async () => {
    const kycService = {
      listForReview: vi.fn().mockResolvedValue([{ id: 'kyc1' }]),
    } as unknown as KycService;
    const controller = new KycController(kycService, {} as KycVerificationService);
    const res = mockRes();
    const req = {
      id: 'req-1',
      userId: 'admin1',
      query: { status: 'pending' },
    } as unknown as Request;

    controller.listForReview(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(kycService.listForReview).toHaveBeenCalledWith('pending');
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual({
      records: [{ id: 'kyc1' }],
    });
  });

  it('listForReview passes undefined when no status filter is given', async () => {
    const kycService = { listForReview: vi.fn().mockResolvedValue([]) } as unknown as KycService;
    const controller = new KycController(kycService, {} as KycVerificationService);
    const res = mockRes();
    const req = { id: 'req-1', userId: 'admin1', query: {} } as unknown as Request;

    controller.listForReview(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(kycService.listForReview).toHaveBeenCalledWith(undefined);
  });

  it('approve passes the target userId and the acting admin id to the service', async () => {
    const approved = { id: 'kyc1', status: 'verified' };
    const kycService = { approve: vi.fn().mockResolvedValue(approved) } as unknown as KycService;
    const controller = new KycController(kycService, {} as KycVerificationService);
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
    const controller = new KycController(kycService, {} as KycVerificationService);
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
