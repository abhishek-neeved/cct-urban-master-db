import type { User } from '@modules/auth/user.types';
import type { KycRecord } from '@modules/kyc/kyc.types';
import type { CriminalRecordCheck } from '@modules/criminal-record/criminal-record.types';
import type { Subscription } from '@modules/subscriptions/subscriptions.types';

/**
 * Composed view for the dashboard screen — profile essentials plus every
 * other module's status, so the client can render the whole screen from one
 * request instead of the 3-4 separate ones mobile-app's mock layer makes
 * today. Purely a read-side composition: no new persisted state, no model.
 */
export interface DashboardSummary {
  user: Pick<User, 'firstName' | 'lastName' | 'email'>;
  kyc: KycRecord;
  criminalRecord: CriminalRecordCheck;
  subscription: Subscription;
}
