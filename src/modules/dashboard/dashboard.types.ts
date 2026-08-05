import type { User } from '@modules/auth/user.types';
import type { KycRecord } from '@modules/kyc/kyc.types';
import type { CriminalRecordCheck } from '@modules/criminal-record/criminal-record.types';
import type { OnboardingFee } from '@modules/onboarding-fee/onboarding-fee.types';

/**
 * Composed view for the dashboard screen — profile essentials plus every
 * other module's status, so the client can render the whole screen from one
 * request instead of the 3-4 separate ones mobile-app's mock layer makes
 * today. Purely a read-side composition: no new persisted state, no model.
 *
 * `kyc`/`criminalRecord`/`onboardingFee` are only populated for a
 * `service_provider` — a `customer` only books services and never goes
 * through that onboarding, so those fields are omitted (not just empty)
 * rather than returning another role's defaults.
 */
export interface DashboardSummary {
  user: Pick<User, 'firstName' | 'lastName' | 'email' | 'role'>;
  kyc?: KycRecord;
  criminalRecord?: CriminalRecordCheck;
  onboardingFee?: OnboardingFee;
}
