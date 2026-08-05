import { Request, RequestHandler, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { UploadsService } from './uploads.service';
import { asyncHandler } from '@middleware/async-handler';
import { success } from '@models/api-response';

/**
 * Upload HTTP handlers. Request bodies/queries are validated upstream by the
 * `validate` middleware, so these read already-validated data and just map
 * service results to responses.
 */
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  presign: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const { purpose, contentType } = req.body;
    const presigned = await this.uploadsService.createUploadUrl(
      req.userId as string,
      purpose,
      contentType
    );
    res.status(StatusCodes.OK).json(success(presigned, req.id));
  });

  view: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const viewUrl = await this.uploadsService.getViewUrl(
      req.userId as string,
      String(req.query.key)
    );
    res.status(StatusCodes.OK).json(success({ viewUrl }, req.id));
  });
}
