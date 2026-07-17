import { z } from 'zod';
import { CHAIN_TYPES } from '@nvcct/db-entities';

export const listBlockchainsQuerySchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  chainType: z.enum(CHAIN_TYPES).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
});

export type ListBlockchainsQuery = z.infer<typeof listBlockchainsQuerySchema>;
