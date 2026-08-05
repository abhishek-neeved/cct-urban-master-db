import { vi, type Mocked } from 'vitest';
import {
  OnboardingFeeService,
  type RazorpayPaymentLinkWebhookPayload,
} from '@modules/onboarding-fee/onboarding-fee.service';
import type { IOnboardingFeeRepository } from '@modules/onboarding-fee/onboarding-fee.repository';
import type { IUserRepository } from '@modules/auth/user.repository';
import type { IPaymentGateway } from '@shared/services/payment-gateway.service';
import {
  UNPAID_ONBOARDING_FEE,
  type OnboardingFee,
} from '@modules/onboarding-fee/onboarding-fee.types';
import type { User } from '@modules/auth/user.types';
import { BadRequestError, ConflictError, NotFoundError } from '@utils/errors';

const buildOnboardingFee = (overrides: Partial<OnboardingFee> = {}): OnboardingFee => ({
  status: 'unpaid',
  amountInRupees: 10,
  ...overrides,
});

const buildUser = (overrides: Partial<User> = {}): User => ({
  id: 'u1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  role: 'service_provider',
  serviceCategory: null,
  phoneNumber: null,
  isVerified: true,
  createdAt: new Date('2020-01-01'),
  updatedAt: new Date('2020-01-01'),
  ...overrides,
});

describe('OnboardingFeeService', () => {
  let onboardingFees: Mocked<IOnboardingFeeRepository>;
  let users: Mocked<Pick<IUserRepository, 'findById'>>;
  let gateway: Mocked<IPaymentGateway>;
  let service: OnboardingFeeService;

  beforeEach(() => {
    onboardingFees = {
      findByUserId: vi.fn(),
      findRowByUserId: vi.fn(),
      findRowByPaymentLinkId: vi.fn(),
      create: vi.fn(),
      deleteByUserId: vi.fn(),
      applyPaymentUpdate: vi.fn(),
    };
    users = { findById: vi.fn() };
    gateway = {
      createPaymentLink: vi.fn(),
      verifyWebhookSignature: vi.fn(),
      verifyPaymentLinkCallback: vi.fn(),
    };
    service = new OnboardingFeeService(
      onboardingFees,
      users as unknown as IUserRepository,
      gateway
    );
  });

  describe('getStatus', () => {
    it('returns the default unpaid fee when no row exists', async () => {
      onboardingFees.findByUserId.mockResolvedValue(null);

      await expect(service.getStatus('u1')).resolves.toEqual(UNPAID_ONBOARDING_FEE);
    });

    it('returns the stored fee (paid) when one exists', async () => {
      const fee = buildOnboardingFee({ status: 'paid', paidAt: new Date('2020-01-05') });
      onboardingFees.findByUserId.mockResolvedValue(fee);

      await expect(service.getStatus('u1')).resolves.toEqual(fee);
    });
  });

  describe('checkout', () => {
    it('creates a Razorpay payment link and persists it', async () => {
      onboardingFees.findByUserId.mockResolvedValue(null);
      users.findById.mockResolvedValue(buildUser());
      gateway.createPaymentLink.mockResolvedValue({
        id: 'plink_1',
        status: 'created',
        shortUrl: 'https://rzp.io/i/abc',
      });
      onboardingFees.create.mockResolvedValue(buildOnboardingFee());

      const result = await service.checkout('u1', 'https://app.example.com/callback');

      expect(gateway.createPaymentLink).toHaveBeenCalledWith({
        amountInRupees: 10,
        referenceId: expect.stringMatching(/^u1-\d+$/),
        description: 'CoinCircleTrust onboarding fee',
        callbackUrl: 'https://app.example.com/callback',
        customerEmail: 'ada@example.com',
        customerName: 'Ada Lovelace',
      });
      expect(onboardingFees.create).toHaveBeenCalledWith({
        userId: 'u1',
        razorpayPaymentLinkId: 'plink_1',
        status: 'created',
      });
      expect(onboardingFees.deleteByUserId).not.toHaveBeenCalled();
      expect(result).toEqual({ shortUrl: 'https://rzp.io/i/abc' });
    });

    it('rejects with ConflictError when the fee has already been paid, without touching the gateway', async () => {
      onboardingFees.findByUserId.mockResolvedValue(buildOnboardingFee({ status: 'paid' }));

      await expect(service.checkout('u1', 'https://app.example.com/callback')).rejects.toThrow(
        ConflictError
      );
      expect(users.findById).not.toHaveBeenCalled();
      expect(gateway.createPaymentLink).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when the user no longer exists, without creating a payment link', async () => {
      onboardingFees.findByUserId.mockResolvedValue(null);
      users.findById.mockResolvedValue(null);

      await expect(service.checkout('u1', 'https://app.example.com/callback')).rejects.toThrow(
        NotFoundError
      );
      expect(gateway.createPaymentLink).not.toHaveBeenCalled();
      expect(onboardingFees.deleteByUserId).not.toHaveBeenCalled();
    });

    it('deletes a stale non-paid row before creating a fresh payment link', async () => {
      onboardingFees.findByUserId.mockResolvedValue(buildOnboardingFee({ status: 'unpaid' }));
      users.findById.mockResolvedValue(buildUser());
      gateway.createPaymentLink.mockResolvedValue({
        id: 'plink_2',
        status: 'created',
        shortUrl: 'https://rzp.io/i/def',
      });
      onboardingFees.create.mockResolvedValue(buildOnboardingFee());

      const result = await service.checkout('u1', 'https://app.example.com/callback');

      expect(onboardingFees.deleteByUserId).toHaveBeenCalledWith('u1');
      expect(gateway.createPaymentLink).toHaveBeenCalled();
      expect(result).toEqual({ shortUrl: 'https://rzp.io/i/def' });
    });
  });

  describe('confirmCallback', () => {
    it('applies a paid status with paidAt to the matching row', async () => {
      onboardingFees.applyPaymentUpdate.mockResolvedValue(buildOnboardingFee({ status: 'paid' }));
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2020-01-10T00:00:00.000Z'));

      await service.confirmCallback('plink_1');

      expect(onboardingFees.applyPaymentUpdate).toHaveBeenCalledWith('plink_1', {
        status: 'paid',
        paidAt: new Date('2020-01-10T00:00:00.000Z'),
      });
      vi.useRealTimers();
    });

    it('throws BadRequestError when no matching row is found', async () => {
      onboardingFees.applyPaymentUpdate.mockResolvedValue(null);

      await expect(service.confirmCallback('plink_unknown')).rejects.toThrow(BadRequestError);
    });
  });

  describe('handleWebhookEvent', () => {
    const buildPayload = (
      overrides: Partial<RazorpayPaymentLinkWebhookPayload> = {}
    ): RazorpayPaymentLinkWebhookPayload => ({
      event: 'payment_link.paid',
      payload: {
        payment_link: {
          entity: {
            id: 'plink_1',
            status: 'paid',
          },
        },
      },
      ...overrides,
    });

    it('applies status and paidAt from the payment_link entity when paid', async () => {
      onboardingFees.applyPaymentUpdate.mockResolvedValue(buildOnboardingFee({ status: 'paid' }));
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2020-01-10T00:00:00.000Z'));

      await service.handleWebhookEvent(buildPayload());

      expect(onboardingFees.applyPaymentUpdate).toHaveBeenCalledWith('plink_1', {
        status: 'paid',
        paidAt: new Date('2020-01-10T00:00:00.000Z'),
      });
      vi.useRealTimers();
    });

    it('applies status without paidAt when the status is not paid', async () => {
      onboardingFees.applyPaymentUpdate.mockResolvedValue(buildOnboardingFee({ status: 'unpaid' }));

      await service.handleWebhookEvent(
        buildPayload({
          event: 'payment_link.cancelled',
          payload: { payment_link: { entity: { id: 'plink_1', status: 'cancelled' } } },
        })
      );

      expect(onboardingFees.applyPaymentUpdate).toHaveBeenCalledWith('plink_1', {
        status: 'cancelled',
        paidAt: undefined,
      });
    });

    it('ignores a payload with no payment_link entity, without throwing', async () => {
      await expect(
        service.handleWebhookEvent({
          event: 'some.other.event',
          payload: {} as never,
        })
      ).resolves.toBeUndefined();

      expect(onboardingFees.applyPaymentUpdate).not.toHaveBeenCalled();
    });

    it('ignores a webhook for an unknown payment-link id without throwing', async () => {
      onboardingFees.applyPaymentUpdate.mockResolvedValue(null);

      await expect(service.handleWebhookEvent(buildPayload())).resolves.toBeUndefined();
    });
  });
});
