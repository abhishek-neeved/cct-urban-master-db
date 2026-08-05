import express, { Application } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { corsMiddleware } from '@middleware/cors';
import { requestIdMiddleware } from '@middleware/request-id';
import { requestLoggerMiddleware } from '@middleware/request-logger';
import { errorHandler, notFoundHandler } from '@middleware/error-handler';
import { createApiRouter } from '@routes/index';

export const createApp = (): Application => {
  const app = express();

  // Security & parsing
  app.use(helmet());
  app.use(corsMiddleware());
  app.use(
    express.json({
      limit: '100kb',
      // Capture the exact raw bytes before parsing — Razorpay's webhook
      // signature (@modules/onboarding-fee) is an HMAC over the raw body, and
      // re-serializing the parsed JSON is not guaranteed byte-identical to
      // what Razorpay actually signed.
      verify: (req: express.Request, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Observability: request id must come before the logger
  app.use(requestIdMiddleware);
  app.use(requestLoggerMiddleware);

  // API routes (docs are mounted inside the router at /api/docs)
  app.use('/api', createApiRouter());

  // 404 + centralised error handling (must be last)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
