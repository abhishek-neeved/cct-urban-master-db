import { LoginAttemptRepository } from '@modules/auth/login-attempt.repository';
import { connectTestDb, clearTestDb, closeTestDb } from '../../helpers/db';

describe('LoginAttemptRepository (integration)', () => {
  let repository: LoginAttemptRepository;

  beforeAll(connectTestDb);
  afterEach(clearTestDb);
  afterAll(closeTestDb);

  beforeEach(() => {
    repository = new LoginAttemptRepository();
  });

  it('returns null for an email that has never been attempted', async () => {
    await expect(repository.find('nobody@example.com')).resolves.toBeNull();
  });

  it('creates a record on the first failed attempt and increments it thereafter', async () => {
    await expect(repository.recordFailedAttempt('ada@example.com')).resolves.toBe(1);
    await expect(repository.recordFailedAttempt('ada@example.com')).resolves.toBe(2);
    await expect(repository.find('ada@example.com')).resolves.toEqual({
      attempts: 2,
      lockedUntil: null,
    });
  });

  it('tracks a nonexistent email exactly like a real one — no account is required', async () => {
    // This repository never checks whether the email belongs to a real user —
    // that's the whole point: lockout state can't be used to tell a
    // registered email apart from a made-up one.
    await expect(repository.recordFailedAttempt('made-up@example.com')).resolves.toBe(1);
    const until = new Date(Date.now() + 60_000);
    await repository.lock('made-up@example.com', until);

    const state = await repository.find('made-up@example.com');
    expect(state?.lockedUntil?.getTime()).toBe(until.getTime());
  });

  it('locks and later clears both the counter and the lock on reset', async () => {
    const until = new Date(Date.now() + 60_000);
    await repository.recordFailedAttempt('ada@example.com');
    await repository.lock('ada@example.com', until);

    await expect(repository.find('ada@example.com')).resolves.toEqual({
      attempts: 1,
      lockedUntil: until,
    });

    await repository.reset('ada@example.com');
    await expect(repository.find('ada@example.com')).resolves.toEqual({
      attempts: 0,
      lockedUntil: null,
    });

    // The counter really was reset, not just the lock.
    await expect(repository.recordFailedAttempt('ada@example.com')).resolves.toBe(1);
  });

  it('is keyed by lowercased email, matching how the service normalizes it', async () => {
    await repository.recordFailedAttempt('Ada@Example.com');
    await expect(repository.find('ada@example.com')).resolves.toEqual({
      attempts: 1,
      lockedUntil: null,
    });
  });

  it('tracks different emails independently', async () => {
    await repository.recordFailedAttempt('ada@example.com');
    await repository.recordFailedAttempt('ada@example.com');
    await repository.recordFailedAttempt('grace@example.com');

    await expect(repository.find('ada@example.com')).resolves.toEqual({
      attempts: 2,
      lockedUntil: null,
    });
    await expect(repository.find('grace@example.com')).resolves.toEqual({
      attempts: 1,
      lockedUntil: null,
    });
  });
});
