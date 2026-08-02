import { AbilityBuilder, createMongoAbility, MongoAbility } from '@casl/ability';
import type { UserRole } from '@modules/auth/user.types';

/**
 * Actions and subjects kept coarse (module-level, not field-level) — every
 * check today is "can this role touch this module's routes at all", not a
 * per-record ownership rule (routes already scope reads/writes to `req.userId`
 * via `/me` semantics). Extend the subject union as new modules need gating.
 */
export type Action = 'manage' | 'read' | 'create' | 'update';
export type Subject = 'Kyc' | 'CriminalRecord' | 'Subscription' | 'AdminReview' | 'ServiceProviderDirectory' | 'all';

export type AppAbility = MongoAbility<[Action, Subject]>;

/**
 * Single source of truth for what each role may do. `admin` can manage
 * everything, including the admin-review actions. `service_provider` is the
 * only role that goes through onboarding (KYC, criminal-record check,
 * subscription) — that's the gate the platform puts a paid provider through
 * before they can be booked. `customer` only books services — they can't
 * touch the onboarding modules, but they can read the provider directory
 * (that's how they find someone to book); a `service_provider` has no reason
 * to browse the directory themselves, so it's read-only for admin/customer.
 */
export const defineAbilitiesFor = (role: UserRole): AppAbility => {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

  switch (role) {
    case 'admin':
      can('manage', 'all');
      break;
    case 'service_provider':
      can(['read', 'create', 'update'], ['Kyc', 'CriminalRecord', 'Subscription']);
      break;
    case 'customer':
      can('read', 'ServiceProviderDirectory');
      break;
  }

  return build();
};
