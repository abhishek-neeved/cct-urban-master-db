import { vi, type Mocked } from 'vitest';
import { SubscriptionsService } from '@modules/subscriptions/subscriptions.service';
import type { ISubscriptionsRepository } from '@modules/subscriptions/subscriptions.repository';
import type { IPaymentGateway } from '@shared/services/payment-gateway.service';
import { INACTIVE_SUBSCRIPTION, MONTHLY_PLAN, type Subscription } from '@modules/subscriptions/subscriptions.types';
import type { SubscriptionRow } from '@modules/subscriptions/subscriptions.model';
import { BadRequestError, ConflictError } from '@utils/errors';

const buildSubscription = (overrides: Partial<Subscription> = {}): Subscription => ({
  status: 'active',
  plan: MONTHLY_PLAN,
  startedAt: new Date('2020-01-01'),
  renewsAt: new Date('2020-02-01'),
  ...overrides,
});

const buildRow = (overrides: Partial<SubscriptionRow> = {}): SubscriptionRow =>
  ({
    userId: 'u1',
    razorpaySubscriptionId: 'sub_1',
    razorpayStatus: 'active',
    startedAt: new Date('2020-01-01'),
    renewsAt: new Date('2020-02-01'),
    cancelledAt: null,
    ...overrides,
  }) as SubscriptionRow;

describe('SubscriptionsService', () => {
  let subscriptions: Mocked<ISubscriptionsRepository>;
  let gateway: Mocked<IPaymentGateway>;
  let service: SubscriptionsService;

  beforeEach(() => {
    subscriptions = {
      findByUserId: vi.fn(),
      findRowByUserId: vi.fn(),
      create: vi.fn(),
      applyWebhookUpdate: vi.fn(),
    };
    gateway = {
      createSubscription: vi.fn(),
      cancelSubscription: vi.fn(),
      verifyWebhookSignature: vi.fn(),
    };
    service = new SubscriptionsService(subscriptions, gateway);
  });

  describe('getStatus', () => {
    it('returns "inactive" when no subscription exists', async () => {
      subscriptions.findByUserId.mockResolvedValue(null);

      await expect(service.getStatus('u1')).resolves.toEqual(INACTIVE_SUBSCRIPTION);
    });

    it('returns the stored subscription when one exists', async () => {
      const sub = buildSubscription();
      subscriptions.findByUserId.mockResolvedValue(sub);

      await expect(service.getStatus('u1')).resolves.toEqual(sub);
    });
  });

  describe('checkout', () => {
    it('creates a Razorpay subscription and persists it', async () => {
      subscriptions.findByUserId.mockResolvedValue(null);
      gateway.createSubscription.mockResolvedValue({
        id: 'sub_1',
        status: 'created',
        shortUrl: 'https://rzp.io/i/abc',
      });
      subscriptions.create.mockResolvedValue(buildSubscription({ status: 'inactive' }));

      const result = await service.checkout('u1');

      expect(gateway.createSubscription).toHaveBeenCalledWith('plan_placeholder');
      expect(subscriptions.create).toHaveBeenCalledWith({
        userId: 'u1',
        razorpaySubscriptionId: 'sub_1',
        razorpayStatus: 'created',
      });
      expect(result).toEqual({ razorpaySubscriptionId: 'sub_1', shortUrl: 'https://rzp.io/i/abc' });
    });

    it('rejects with ConflictError when already active', async () => {
      subscriptions.findByUserId.mockResolvedValue(buildSubscription({ status: 'active' }));

      await expect(service.checkout('u1')).rejects.toThrow(ConflictError);
      expect(gateway.createSubscription).not.toHaveBeenCalled();
    });

    it('allows checkout again when the existing subscription is cancelled', async () => {
      subscriptions.findByUserId.mockResolvedValue(buildSubscription({ status: 'cancelled' }));
      gateway.createSubscription.mockResolvedValue({
        id: 'sub_2',
        status: 'created',
        shortUrl: 'https://rzp.io/i/def',
      });
      subscriptions.create.mockResolvedValue(buildSubscription());

      await expect(service.checkout('u1')).resolves.toBeDefined();
      expect(gateway.createSubscription).toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('cancels an active subscription via the gateway', async () => {
      subscriptions.findRowByUserId.mockResolvedValue(buildRow({ razorpayStatus: 'active' }));

      await service.cancel('u1');

      expect(gateway.cancelSubscription).toHaveBeenCalledWith('sub_1', false);
    });

    it('throws BadRequestError when no subscription exists', async () => {
      subscriptions.findRowByUserId.mockResolvedValue(null);

      await expect(service.cancel('u1')).rejects.toThrow(BadRequestError);
      expect(gateway.cancelSubscription).not.toHaveBeenCalled();
    });

    it('throws BadRequestError when the subscription is not active', async () => {
      subscriptions.findRowByUserId.mockResolvedValue(buildRow({ razorpayStatus: 'cancelled' }));

      await expect(service.cancel('u1')).rejects.toThrow(BadRequestError);
      expect(gateway.cancelSubscription).not.toHaveBeenCalled();
    });
  });

  describe('handleWebhookEvent', () => {
    const buildPayload = (overrides: Partial<Parameters<typeof service.handleWebhookEvent>[0]> = {}) => ({
      event: 'subscription.activated',
      payload: {
        subscription: {
          entity: {
            id: 'sub_1',
            status: 'active' as const,
            current_start: 1577836800,
            current_end: 1580515200,
            ended_at: null,
          },
        },
      },
      ...overrides,
    });

    it('applies the webhook update, converting Unix timestamps to Dates', async () => {
      subscriptions.applyWebhookUpdate.mockResolvedValue(buildSubscription());

      await service.handleWebhookEvent(buildPayload());

      expect(subscriptions.applyWebhookUpdate).toHaveBeenCalledWith('sub_1', {
        razorpayStatus: 'active',
        startedAt: new Date(1577836800 * 1000),
        renewsAt: new Date(1580515200 * 1000),
        cancelledAt: undefined,
      });
    });

    it('sets cancelledAt when ended_at is present', async () => {
      subscriptions.applyWebhookUpdate.mockResolvedValue(buildSubscription({ status: 'cancelled' }));

      await service.handleWebhookEvent(
        buildPayload({
          event: 'subscription.cancelled',
          payload: {
            subscription: {
              entity: {
                id: 'sub_1',
                status: 'cancelled',
                current_start: null,
                current_end: null,
                ended_at: 1580515200,
              },
            },
          },
        })
      );

      expect(subscriptions.applyWebhookUpdate).toHaveBeenCalledWith(
        'sub_1',
        expect.objectContaining({ cancelledAt: new Date(1580515200 * 1000) })
      );
    });

    it('ignores a payload with no subscription entity', async () => {
      await service.handleWebhookEvent({
        event: 'some.other.event',
        payload: {} as never,
      });

      expect(subscriptions.applyWebhookUpdate).not.toHaveBeenCalled();
    });

    it('ignores a webhook for an unknown subscription id without throwing', async () => {
      subscriptions.applyWebhookUpdate.mockResolvedValue(null);

      await expect(service.handleWebhookEvent(buildPayload())).resolves.toBeUndefined();
    });
  });
});
