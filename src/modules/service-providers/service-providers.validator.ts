import { z } from 'zod';

export const listServiceProvidersQuerySchema = z.object({
  category: z.enum(['electrician', 'plumber', 'cleaner', 'carpenter', 'painter', 'other']).optional(),
});
