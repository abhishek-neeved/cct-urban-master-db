import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { isDatabaseConnected } from '@config/database';
import { failure, success } from '@models/api-response';

export class HealthController {
  /**
   * Combined liveness + readiness probe. Reports `ok: 1` with 200 when the
   * process is up AND MongoDB is reachable, or `ok: -1` with 503 when the
   * database is unavailable. Point both orchestrator probes at this endpoint.
   */
  check = (req: Request, res: Response): void => {
    if (isDatabaseConnected()) {
      res
        .status(StatusCodes.OK)
        .json(success({ ok: 1, db: 'up', uptime: process.uptime() }, req.id));
    } else {
      res
        .status(StatusCodes.SERVICE_UNAVAILABLE)
        .json(failure('Service unhealthy: database unavailable', req.id, { ok: -1, db: 'down' }));
    }
  };
}
