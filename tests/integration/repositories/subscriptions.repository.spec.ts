import { Types } from 'mongoose';
import { SubscriptionsRepository } from '@modules/subscriptions/subscriptions.repository';
import { connectTestDb, clearTestDb, closeTestDb } from '../../helpers/db';

describe('SubscriptionsRepository (integration)', () => {
  let repository: SubscriptionsRepository;
  const userId = new Types.ObjectId().toString();

  beforeAll(connectTestDb);
  afterEach(clearTestDb);
  afterAll(closeTestDb);

  beforeEach(() => {
    repository = new SubscriptionsRepository();
  });

  it('returns null when no subscription exists for the user', async () => {
    await expect(repository.findByUserId(userId)).resolves.toBeNull();
    await expect(repository.findRowByUserId(userId)).resolves.toBeNull();
  });

  it('creates a subscription, mapping the domain status from the raw Razorpay status', async () => {
    const created = await repository.create({
      userId,
      razorpaySubscriptionId: 'sub_1',
      razorpayStatus: 'created',
    });

    expect(created.status).toBe('inactive');
    expect(created.plan.id).toBe('monthly');
    await expect(repository.findByUserId(userId)).resolves.toEqual(created);
  });

  it('exposes razorpaySubscriptionId only via the row lookup, never the domain type', async () => {
    await repository.create({ userId, razorpaySubscriptionId: 'sub_1', razorpayStatus: 'created' });

    const row = await repository.findRowByUserId(userId);
    expect(row?.razorpaySubscriptionId).toBe('sub_1');

    const domain = await repository.findByUserId(userId);
    expect(domain).not.toHaveProperty('razorpaySubscriptionId');
  });

  it('rejects a duplicate subscription for the same user with a ConflictError', async () => {
    await repository.create({ userId, razorpaySubscriptionId: 'sub_1', razorpayStatus: 'created' });

    await expect(
      repository.create({ userId, razorpaySubscriptionId: 'sub_2', razorpayStatus: 'created' })
    ).rejects.toThrow('A subscription already exists for this user');
  });

  it('applies a webhook update, converting status to the client-facing view', async () => {
    await repository.create({ userId, razorpaySubscriptionId: 'sub_1', razorpayStatus: 'created' });

    const updated = await repository.applyWebhookUpdate('sub_1', {
      razorpayStatus: 'active',
      startedAt: new Date('2020-01-01'),
      renewsAt: new Date('2020-02-01'),
    });

    expect(updated?.status).toBe('active');
    expect(updated?.startedAt).toEqual(new Date('2020-01-01'));
    await expect(repository.findByUserId(userId)).resolves.toEqual(updated);
  });

  it('returns null from applyWebhookUpdate for an unknown razorpaySubscriptionId', async () => {
    await expect(
      repository.applyWebhookUpdate('sub_unknown', { razorpayStatus: 'active' })
    ).resolves.toBeNull();
  });
});
