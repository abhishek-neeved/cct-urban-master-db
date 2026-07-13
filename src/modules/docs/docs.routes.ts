import { NextFunction, Request, Response, Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from '@shared/docs/openapi';

/**
 * Docs module: serves the OpenAPI document as JSON and the Swagger UI. Mounted
 * under `/api`, so the endpoints resolve to `/api/docs.json` and `/api/docs`.
 */
export const createDocsModule = (): Router => {
  const router = Router();

  router.get('/docs.json', (_req, res) => res.json(openApiDocument));

  router.use(
    '/docs',
    // Swagger UI needs inline scripts/styles; relax CSP for this route only.
    (_req: Request, res: Response, next: NextFunction) => {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:"
      );
      next();
    },
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument)
  );

  return router;
};
