import { LoginAttemptModel } from './auth.model';

export interface LoginAttemptState {
  attempts: number;
  lockedUntil: Date | null;
}

export interface ILoginAttemptRepository {
  /** Current attempt/lock state for an email, or `null` if it's never been attempted. */
  find(email: string): Promise<LoginAttemptState | null>;
  /** Record a wrong-password attempt against an email and return the new attempt count. */
  recordFailedAttempt(email: string): Promise<number>;
  /** Lock an email against login until `until`. */
  lock(email: string, until: Date): Promise<void>;
  /** Clear the failed-attempt counter and any lock for an email. */
  reset(email: string): Promise<void>;
}

/**
 * Login-attempt throttling keyed by **email**, not user id — see
 * `LoginAttemptRow` in `auth.model` for why: this repository is written to
 * identically whether or not the email belongs to a real account, so account
 * lockout can't become an oracle an attacker uses to enumerate which emails
 * are registered.
 */
export class LoginAttemptRepository implements ILoginAttemptRepository {
  async find(email: string): Promise<LoginAttemptState | null> {
    const doc = await LoginAttemptModel.findOne({ email: email.toLowerCase() }).lean();
    return doc ? { attempts: doc.attempts, lockedUntil: doc.lockedUntil } : null;
  }

  async recordFailedAttempt(email: string): Promise<number> {
    // Upsert: the first-ever wrong attempt against an email (registered or
    // not) has no existing document yet.
    const doc = await LoginAttemptModel.findOneAndUpdate(
      { email: email.toLowerCase() },
      { $inc: { attempts: 1 } },
      { new: true, upsert: true }
    ).lean();
    return doc.attempts;
  }

  async lock(email: string, until: Date): Promise<void> {
    await LoginAttemptModel.updateOne(
      { email: email.toLowerCase() },
      { lockedUntil: until },
      { upsert: true }
    );
  }

  async reset(email: string): Promise<void> {
    await LoginAttemptModel.updateOne(
      { email: email.toLowerCase() },
      { attempts: 0, lockedUntil: null }
    );
  }
}
