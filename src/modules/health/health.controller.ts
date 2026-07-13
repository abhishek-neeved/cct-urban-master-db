import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { isDatabaseConnected } from '@config/database';
import { failure, success } from '@models/api-response';

export class HealthController {
  /** Liveness: is the process up? Never depends on external services. */
  live = (req: Request, res: Response): void => {
    res.status(StatusCodes.OK).json(success({ status: 'ok', uptime: process.uptime() }, req.id));
  };

  /** Readiness: can we actually serve traffic (i.e. is MongoDB connected)? */
  ready = (req: Request, res: Response): void => {
    if (isDatabaseConnected()) {
      res.status(StatusCodes.OK).json(success({ status: 'ready', db: 'up' }, req.id));
    } else {
      res
        .status(StatusCodes.SERVICE_UNAVAILABLE)
        .json(failure('Service not ready: database unavailable', req.id));
    }
  };
}
