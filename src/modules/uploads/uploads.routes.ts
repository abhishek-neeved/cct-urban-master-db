import { Router } from 'express';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { S3StorageService } from '@shared/services/storage.service';
import { validate } from '@middleware/validate';
import { requireAuth } from '@middleware/require-auth';
import { presignUploadSchema, viewUploadQuerySchema } from './uploads.validator';

/**
 * Uploads feature module: presigned S3 upload/view URLs. Consumed by `kyc`
 * (and any future feature needing a file in object storage) rather than
 * folded into it — the presign flow is the same regardless of what the file is for.
 */
export const createUploadsModule = (): Router => {
  const storage = new S3StorageService();
  const uploadsService = new UploadsService(storage);
  const controller = new UploadsController(uploadsService);

  const router = Router();

  /**
   * @openapi
   * /api/uploads/presign:
   *   post:
   *     tags: [Uploads]
   *     summary: Get a short-lived presigned URL to upload a file directly to object storage
   *     description: >
   *       The client PUTs the raw file bytes to `uploadUrl` with the same
   *       `Content-Type` used here — the file never transits this server.
   *       Persist the returned `key` and submit it with the resource it
   *       belongs to (e.g. a KYC submission).
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/PresignUploadRequest' }
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/PresignedUpload' }
   *       401: { description: Missing/invalid access token }
   *       422: { description: Validation failed }
   */
  router.post(
    '/presign',
    requireAuth,
    validate({ body: presignUploadSchema }),
    controller.presign
  );

  /**
   * @openapi
   * /api/uploads/view:
   *   get:
   *     tags: [Uploads]
   *     summary: Get a short-lived presigned URL to view a previously uploaded file
   *     description: >
   *       Objects are private by default — this is the only way to read one
   *       back. Rejects with 403 if the key does not belong to the caller.
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: query
   *         name: key
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 viewUrl: { type: string }
   *       401: { description: Missing/invalid access token }
   *       403: { description: The key does not belong to the caller }
   *       422: { description: Validation failed }
   */
  router.get('/view', requireAuth, validate({ query: viewUploadQuerySchema }), controller.view);

  return router;
};
