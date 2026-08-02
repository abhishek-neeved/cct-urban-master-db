import { Request, RequestHandler, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ServiceProvidersService } from './service-providers.service';
import { asyncHandler } from '@middleware/async-handler';
import { success } from '@models/api-response';
import type { ServiceCategory } from '@modules/auth/user.types';

export class ServiceProvidersController {
  constructor(private readonly serviceProvidersService: ServiceProvidersService) {}

  list: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const category = req.query.category as ServiceCategory | undefined;
    const providers = await this.serviceProvidersService.list(category);
    res.status(StatusCodes.OK).json(success({ providers }, req.id));
  });
}
