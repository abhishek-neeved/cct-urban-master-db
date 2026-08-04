import { Types } from 'mongoose';
import { OnboardingFeeRepository } from '@modules/onboarding-fee/onboarding-fee.repository';
import { connectTestDb, clearTestDb, closeTestDb } from '../../helpers/db';

describe('OnboardingFeeRepository (integration)', () => {
  let repository: OnboardingFeeRepository;
  const userId = new Types.ObjectId().toString();

  beforeAll(connectTestDb);
  afterEach(clearTestDb);
  afterAll(closeTestDb);

  beforeEach(() => {
    repository = new OnboardingFeeRepository();
  });

  it('returns null when no onboarding-fee row exists for the user', async () => {
    await expect(repository.findByUserId(userId)).resolves.toBeNull();
    await expect(repository.findRowByUserId(userId)).resolves.toBeNull();
  });

  it('returns null from findRowByPaymentLinkId for an unknown payment-link id', async () => {
    await expect(repository.findRowByPaymentLinkId('plink_unknown')).resolves.toBeNull();
  });

  it('creates an onboarding-fee row, mapping the domain status from the raw Razorpay status', async () => {
    const created = await repository.create({
      userId,
      razorpayPaymentLinkId: 'plink_1',
      status: 'created',
    });

    expect(created.status).toBe('unpaid');
    expect(created.amountInRupees).toBe(10);
    await expect(repository.findByUserId(userId)).resolves.toEqual(created);
  });

  it('exposes razorpayPaymentLinkId only via the row lookups, never the domain type', async () => {
    await repository.create({ userId, razorpayPaymentLinkId: 'plink_1', status: 'created' });

    const rowByUserId = await repository.findRowByUserId(userId);
    expect(rowByUserId?.razorpayPaymentLinkId).toBe('plink_1');

    const rowByPaymentLinkId = await repository.findRowByPaymentLinkId('plink_1');
    expect(rowByPaymentLinkId?.razorpayPaymentLinkId).toBe('plink_1');

    const domain = await repository.findByUserId(userId);
    expect(domain).not.toHaveProperty('razorpayPaymentLinkId');
  });

  it('rejects a duplicate onboarding-fee row for the same user with a ConflictError', async () => {
    await repository.create({ userId, razorpayPaymentLinkId: 'plink_1', status: 'created' });

    await expect(
      repository.create({ userId, razorpayPaymentLinkId: 'plink_2', status: 'created' })
    ).rejects.toThrow('An onboarding-fee record already exists for this user');
  });

  it('deleteByUserId removes the row, letting a fresh checkout insert a new payment-link id', async () => {
    await repository.create({ userId, razorpayPaymentLinkId: 'plink_1', status: 'created' });

    await repository.deleteByUserId(userId);

    await expect(repository.findByUserId(userId)).resolves.toBeNull();
    await expect(
      repository.create({ userId, razorpayPaymentLinkId: 'plink_2', status: 'created' })
    ).resolves.toBeDefined();
  });

  it('deleteByUserId is a no-op when no row exists for the user', async () => {
    await expect(repository.deleteByUserId(userId)).resolves.toBeUndefined();
  });

  it('applyPaymentUpdate applies a paid status and paidAt by payment-link id', async () => {
    await repository.create({ userId, razorpayPaymentLinkId: 'plink_1', status: 'created' });

    const updated = await repository.applyPaymentUpdate('plink_1', {
      status: 'paid',
      paidAt: new Date('2020-01-10'),
    });

    expect(updated?.status).toBe('paid');
    expect(updated?.paidAt).toEqual(new Date('2020-01-10'));
    await expect(repository.findByUserId(userId)).resolves.toEqual(updated);
  });

  it('returns null from applyPaymentUpdate for an unknown razorpayPaymentLinkId', async () => {
    await expect(
      repository.applyPaymentUpdate('plink_unknown', { status: 'paid', paidAt: new Date() })
    ).resolves.toBeNull();
  });
});
