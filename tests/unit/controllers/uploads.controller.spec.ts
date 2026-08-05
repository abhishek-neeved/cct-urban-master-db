import { vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { UploadsController } from '@modules/uploads/uploads.controller';
import type { UploadsService } from '@modules/uploads/uploads.service';

const mockRes = () =>
  ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  }) as unknown as Response;
const next = vi.fn() as NextFunction;

describe('UploadsController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('presign passes the authenticated user id, purpose, and contentType to the service', async () => {
    const presigned = { uploadUrl: 'https://s3/upload', key: 'kyc-aadhar/u1/uuid', expiresIn: 300 };
    const uploadsService = {
      createUploadUrl: vi.fn().mockResolvedValue(presigned),
    } as unknown as UploadsService;
    const controller = new UploadsController(uploadsService);
    const res = mockRes();
    const req = {
      id: 'req-1',
      userId: 'u1',
      body: { purpose: 'kyc-aadhar', contentType: 'image/jpeg' },
    } as unknown as Request;

    controller.presign(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(uploadsService.createUploadUrl).toHaveBeenCalledWith('u1', 'kyc-aadhar', 'image/jpeg');
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.data).toEqual(presigned);
  });

  it('view passes the authenticated user id and key query param to the service', async () => {
    const uploadsService = {
      getViewUrl: vi.fn().mockResolvedValue('https://s3/view'),
    } as unknown as UploadsService;
    const controller = new UploadsController(uploadsService);
    const res = mockRes();
    const req = {
      id: 'req-1',
      userId: 'u1',
      query: { key: 'kyc-aadhar/u1/uuid' },
    } as unknown as Request;

    controller.view(req, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(uploadsService.getViewUrl).toHaveBeenCalledWith('u1', 'kyc-aadhar/u1/uuid');
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.data).toEqual({ viewUrl: 'https://s3/view' });
  });
});
