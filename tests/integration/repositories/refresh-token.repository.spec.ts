import { RefreshTokenRepository } from '@modules/auth/refresh-token.repository';
import { UserRepository } from '@modules/auth/user.repository';
import { REFRESH_TOKEN_REUSE_GRACE_MS } from '@config/constants';
import { connectTestDb, clearTestDb, closeTestDb } from '../../helpers/db';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// Replays inside the grace window read as a benign race, not reuse (see
// `rotate`'s test below) — anything testing genuine reuse detection must
// replay after this window has elapsed.
const sleepPastReuseGrace = () => sleep(REFRESH_TOKEN_REUSE_GRACE_MS + 100);

describe('RefreshTokenRepository (integration)', () => {
  let repository: RefreshTokenRepository;
  let users: UserRepository;
  let userId: string;

  beforeAll(connectTestDb);
  afterEach(clearTestDb);
  afterAll(closeTestDb);

  beforeEach(async () => {
    repository = new RefreshTokenRepository();
    users = new UserRepository();
    // refresh tokens reference a real user id, so every test needs an actual
    // persisted user to attach tokens to.
    const user = await users.create({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      password: 'hashed-pw',
      role: 'customer',
    });
    userId = user.id;
  });

  const future = () => new Date(Date.now() + 60_000);
  const past = () => new Date(Date.now() - 60_000);

  it('deletes a single token by hash (logout)', async () => {
    await repository.create(userId, 'hash-1', future());
    await repository.deleteByHash('hash-1');

    // A now-deleted token can't be rotated.
    await expect(repository.rotate('hash-1', 'hash-1-new', future())).resolves.toEqual({
      status: 'invalid',
    });
  });

  it('rotates a valid token to a new one, and flags a later replay as reuse', async () => {
    await repository.create(userId, 'hash-a', future());

    await expect(repository.rotate('hash-a', 'hash-b', future())).resolves.toEqual({
      status: 'rotated',
      userId,
    });

    // Replaying the now-rotated-out token well after the grace window is a
    // reuse (theft) signal, not a plain invalid token.
    await sleepPastReuseGrace();
    await expect(repository.rotate('hash-a', 'hash-c', future())).resolves.toEqual({
      status: 'reused',
      userId,
    });
  });

  it('lets only one of two concurrent rotations of the same token win, without flagging reuse', async () => {
    await repository.create(userId, 'hash-race', future());

    const [a, b] = await Promise.all([
      repository.rotate('hash-race', 'hash-race-1', future()),
      repository.rotate('hash-race', 'hash-race-2', future()),
    ]);

    // The loser is within the reuse-grace window of the winner, so it reads
    // as a benign race (plain 'invalid'), not a theft replay ('reused') —
    // a double-tab refresh or retried request must not nuke the whole session.
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(['invalid', 'rotated']);
  });

  it('treats a replay within the grace window as invalid, not reuse', async () => {
    await repository.create(userId, 'hash-quick', future());
    await repository.rotate('hash-quick', 'hash-quick-new', future());

    // Replayed immediately (well inside the grace window) — a benign race,
    // not a theft signal, so the family must survive.
    await expect(repository.rotate('hash-quick', 'hash-quick-x', future())).resolves.toEqual({
      status: 'invalid',
    });
    await expect(
      repository.rotate('hash-quick-new', 'hash-quick-new-2', future())
    ).resolves.toEqual({ status: 'rotated', userId });
  });

  it('does not rotate an expired token, and does not treat it as reuse', async () => {
    await repository.create(userId, 'hash-old', past());
    await expect(repository.rotate('hash-old', 'hash-old-new', future())).resolves.toEqual({
      status: 'invalid',
    });
  });

  it('revokes every token in the family once reuse is detected', async () => {
    await repository.create(userId, 'hash-1', future());
    // Rotate twice, staying within the same family.
    await repository.rotate('hash-1', 'hash-2', future());
    await repository.rotate('hash-2', 'hash-3', future());

    // Replay an already-rotated-out token from earlier in the chain, well
    // after the grace window so it reads as reuse rather than a benign race.
    await sleepPastReuseGrace();
    await expect(repository.rotate('hash-1', 'hash-x', future())).resolves.toEqual({
      status: 'reused',
      userId,
    });

    // The entire family — including the latest, still-otherwise-valid token —
    // must now be gone.
    await expect(repository.rotate('hash-3', 'hash-y', future())).resolves.toEqual({
      status: 'invalid',
    });
  });

  it('starts a new, independent family for each `create` (login)', async () => {
    await repository.create(userId, 'session-a-1', future());
    await repository.create(userId, 'session-b-1', future());

    // Reuse detected in one login session must not revoke the other.
    await repository.rotate('session-a-1', 'session-a-2', future());
    await sleepPastReuseGrace();
    await expect(repository.rotate('session-a-1', 'session-a-x', future())).resolves.toEqual({
      status: 'reused',
      userId,
    });

    await expect(repository.rotate('session-b-1', 'session-b-2', future())).resolves.toEqual({
      status: 'rotated',
      userId,
    });
  });

  it('deletes all tokens for a user (password reset / global logout)', async () => {
    await repository.create(userId, 'hash-a', future());
    await repository.create(userId, 'hash-b', future());

    await repository.deleteAllForUser(userId);

    await expect(repository.rotate('hash-a', 'hash-a-new', future())).resolves.toEqual({
      status: 'invalid',
    });
    await expect(repository.rotate('hash-b', 'hash-b-new', future())).resolves.toEqual({
      status: 'invalid',
    });
  });
});
