import { z } from 'zod';

export const setCriminalRecordStatusSchema = z.object({
  status: z.enum(['pending', 'clear', 'flagged']),
});

export const userIdParamSchema = z.object({
  userId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'userId must be a valid id'),
});
