import { Request, RequestHandler, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { DashboardService } from './dashboard.service';
import { asyncHandler } from '@middleware/async-handler';
import { success } from '@models/api-response';

export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  me: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const summary = await this.dashboardService.getSummary(req.userId as string);
    res.status(StatusCodes.OK).json(success(summary, req.id));
  });
}
