import { z } from 'zod';

export const upsertServiceProfileSchema = z.object({
  category: z.enum(['electrician', 'plumber', 'cleaner', 'carpenter', 'painter', 'other']),
  description: z.string().trim().max(1000).optional(),
  yearsOfExperience: z.coerce.number().int().min(0).max(80).optional(),
});
