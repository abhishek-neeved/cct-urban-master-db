import type { ServiceCategory } from '@modules/auth/user.types';

/**
 * Customer-facing directory entry — deliberately narrow (name, category,
 * phone) since this is "how do I reach this provider", not the provider's
 * full account record. No email/id exposed; a customer contacts by phone,
 * not by messaging inside the app (no in-app contact system yet).
 */
export interface ServiceProviderListing {
  firstName: string;
  lastName: string;
  serviceCategory: ServiceCategory;
  phoneNumber: string | null;
}
