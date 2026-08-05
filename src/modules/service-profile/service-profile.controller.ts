import { Request, RequestHandler, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ServiceProfileService } from './service-profile.service';
import { asyncHandler } from '@middleware/async-handler';
import { success } from '@models/api-response';

export class ServiceProfileController {
  constructor(private readonly serviceProfileService: ServiceProfileService) {}

  me: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const profile = await this.serviceProfileService.getProfile(req.userId as string);
    res.status(StatusCodes.OK).json(success({ profile }, req.id));
  });

  upsert: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const profile = await this.serviceProfileService.upsertProfile(req.userId as string, req.body);
    res.status(StatusCodes.OK).json(success({ profile }, req.id));
  });
}
