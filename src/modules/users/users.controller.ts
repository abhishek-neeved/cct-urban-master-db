import { Request, RequestHandler, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { UsersService } from './users.service';
import { asyncHandler } from '@middleware/async-handler';
import { success } from '@models/api-response';

/**
 * Profile HTTP handlers. Request bodies are validated upstream by the
 * `validate` middleware, so these read already-validated data and just map
 * service results to responses.
 */
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  me: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const user = await this.usersService.getProfile(req.userId as string);
    res.status(StatusCodes.OK).json(success({ user }, req.id));
  });

  updateMe: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const user = await this.usersService.updateProfile(req.userId as string, req.body);
    res.status(StatusCodes.OK).json(success({ user }, req.id));
  });

  setServiceCategory: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const user = await this.usersService.setServiceCategory(
      req.userId as string,
      req.body.serviceCategory
    );
    res.status(StatusCodes.OK).json(success({ user }, req.id));
  });
}
