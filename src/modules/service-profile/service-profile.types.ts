import type { ServiceCategory } from '@modules/auth/user.types';
import type { ServiceProfileRow } from './service-profile.model';

/** Domain representation returned to callers. */
export interface ServiceProfile {
  category: ServiceCategory;
  description: string | null;
  yearsOfExperience: number | null;
}

export interface UpsertServiceProfileInput {
  category: ServiceCategory;
  description?: string;
  yearsOfExperience?: number;
}

export const toServiceProfile = (row: ServiceProfileRow): ServiceProfile => ({
  category: row.category,
  description: row.description,
  yearsOfExperience: row.yearsOfExperience,
});
