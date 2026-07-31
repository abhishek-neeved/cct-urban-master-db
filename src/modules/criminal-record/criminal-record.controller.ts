import { Request, RequestHandler, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { CriminalRecordService } from './criminal-record.service';
import { asyncHandler } from '@middleware/async-handler';
import { success } from '@models/api-response';

/**
 * Criminal-record HTTP handlers. Request bodies/params are validated
 * upstream by the `validate` middleware, so these read already-validated
 * data and just map service results to responses.
 */
export class CriminalRecordController {
  constructor(private readonly criminalRecordService: CriminalRecordService) {}

  me: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const record = await this.criminalRecordService.getStatus(req.userId as string);
    res.status(StatusCodes.OK).json(success(record, req.id));
  });

  setStatus: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const record = await this.criminalRecordService.setStatus(
      req.params.userId,
      req.body.status,
      req.userId as string
    );
    res.status(StatusCodes.OK).json(success(record, req.id));
  });
}
