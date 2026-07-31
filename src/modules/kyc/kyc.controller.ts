import { Request, RequestHandler, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { KycService } from './kyc.service';
import type { KycStatus } from './kyc.model';
import { asyncHandler } from '@middleware/async-handler';
import { success } from '@models/api-response';

/**
 * KYC HTTP handlers. Request bodies/queries/params are validated upstream by
 * the `validate` middleware, so these read already-validated data and just
 * map service results to responses.
 */
export class KycController {
  constructor(private readonly kycService: KycService) {}

  me: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const record = await this.kycService.getStatus(req.userId as string);
    res.status(StatusCodes.OK).json(success(record, req.id));
  });

  submit: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const record = await this.kycService.submit(req.userId as string, {
      ...req.body,
      uan: req.body.uan || undefined,
    });
    res.status(StatusCodes.OK).json(success(record, req.id));
  });

  listForReview: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const status = req.query.status as Exclude<KycStatus, 'not_started'> | undefined;
    const records = await this.kycService.listForReview(status);
    res.status(StatusCodes.OK).json(success({ records }, req.id));
  });

  approve: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const record = await this.kycService.approve(req.params.userId, req.userId as string);
    res.status(StatusCodes.OK).json(success(record, req.id));
  });

  reject: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const record = await this.kycService.reject(
      req.params.userId,
      req.userId as string,
      req.body.reason
    );
    res.status(StatusCodes.OK).json(success(record, req.id));
  });
}
