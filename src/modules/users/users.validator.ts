import { z } from 'zod';

export const updateMeSchema = z
  .object({
    firstName: z.string().min(1, 'First name is required').max(120).optional(),
    lastName: z.string().min(1, 'Last name is required').max(120).optional(),
  })
  .refine((body) => body.firstName !== undefined || body.lastName !== undefined, {
    message: 'At least one field (firstName, lastName) must be provided',
  });
