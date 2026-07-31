import { z } from 'zod';

/** Upload purposes recognised today — new ones (e.g. a future profile photo) extend this list. */
const UPLOAD_PURPOSES = ['kyc-aadhar', 'kyc-pan', 'kyc-photo'] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export const presignUploadSchema = z.object({
  purpose: z.enum(UPLOAD_PURPOSES),
  contentType: z.enum(['image/jpeg', 'image/png', 'application/pdf'], {
    message: 'contentType must be one of image/jpeg, image/png, application/pdf',
  }),
});

export const viewUploadQuerySchema = z.object({
  key: z.string().min(1, 'key is required'),
});
