import { comparePassword, getDummyPasswordHash, hashPassword } from '@utils/password.util';

describe('password.util', () => {
  it('hashes a password to a non-plaintext bcrypt string', async () => {
    const hash = await hashPassword('supersecret');
    expect(hash).not.toBe('supersecret');
    expect(hash.startsWith('$2')).toBe(true);
  });

  it('compares a plaintext password against its hash', async () => {
    const hash = await hashPassword('supersecret');
    await expect(comparePassword('supersecret', hash)).resolves.toBe(true);
    await expect(comparePassword('wrong', hash)).resolves.toBe(false);
  });

  it('computes the dummy hash once and returns the cached value thereafter', async () => {
    const first = await getDummyPasswordHash();
    const second = await getDummyPasswordHash();
    expect(first).toBe(second); // second call hits the cached branch
    expect(first.startsWith('$2')).toBe(true);
  });
});
