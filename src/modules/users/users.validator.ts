import { z } from 'zod';

const phoneNumberSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{7,15}$/, 'Enter a valid phone number');

export const updateMeSchema = z
  .object({
    firstName: z.string().min(1, 'First name is required').max(120).optional(),
    lastName: z.string().min(1, 'Last name is required').max(120).optional(),
    phoneNumber: phoneNumberSchema.optional(),
  })
  .refine((body) => body.firstName !== undefined || body.lastName !== undefined || body.phoneNumber !== undefined, {
    message: 'At least one field (firstName, lastName, phoneNumber) must be provided',
  });

export const setServiceCategorySchema = z.object({
  serviceCategory: z.enum(['electrician', 'plumber', 'cleaner', 'carpenter', 'painter', 'other']),
});
