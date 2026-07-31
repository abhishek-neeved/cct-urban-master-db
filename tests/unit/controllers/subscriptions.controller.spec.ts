import { vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { SubscriptionsController } from '@modules/subscriptions/subscriptions.controller';
import type { SubscriptionsService } from '@modules/subscriptions/subscriptions.service';
import type { IPaymentGateway } from '@shared/services/payment-gateway.service';

const mockRes = () =>
  ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  }) as unknown as Response;
const next = vi.fn() as NextFunction;

const buildGateway = (overrides: Partial<IPaymentGateway> = {}): IPaymentGateway =>
  ({
    createSubscription: vi.fn(),
    cancelSubscription: vi.fn(),
    verifyWebhookSignature: vi.fn(),
    ...overrides,
  }) as IPaymentGateway;

describe('SubscriptionsController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('me returns the status for the authenticated user', async () => {
    const subscription = { status: 'inactive' as const, plan: { id: 'monthly', name: 'Monthly plan', priceInRupees: 10, intervalLabel: 'month' } };
    const service = { getStatus: vi.fn().mockResolvedValue(subscription) } as unknown as SubscriptionsService;
    const controller = new SubscriptionsController(service, buildGateway());
    const res = mockRes();

    controller.me({ id: 'req-1', userId: 'u1' } as Request, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(service.getStatus).toHaveBeenCalledWith('u1');
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual(subscription);
  });

  it('checkout returns the checkout result for the authenticated user', async () => {
    const result = { razorpaySubscriptionId: 'sub_1', shortUrl: 'https://rzp.io/i/abc' };
    const service = { checkout: vi.fn().mockResolvedValue(result) } as unknown as SubscriptionsService;
    const controller = new SubscriptionsController(service, buildGateway());
    const res = mockRes();

    controller.checkout({ id: 'req-1', userId: 'u1' } as Request, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(service.checkout).toHaveBeenCalledWith('u1');
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual(result);
  });

  it('cancel cancels the authenticated user\'s subscription', async () => {
    const service = { cancel: vi.fn().mockResolvedValue(undefined) } as unknown as SubscriptionsService;
    const controller = new SubscriptionsController(service, buildGateway());
    const res = mockRes();

    controller.cancel({ id: 'req-1', userId: 'u1' } as Request, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(service.cancel).toHaveBeenCalledWith('u1');
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual({
      message: 'Subscription cancelled',
    });
  });

  describe('webhook', () => {
    it('verifies the signature against the raw body and applies the event on success', async () => {
      const service = { handleWebhookEvent: vi.fn().mockResolvedValue(undefined) } as unknown as SubscriptionsService;
      const gateway = buildGateway({ verifyWebhookSignature: vi.fn().mockReturnValue(true) });
      const controller = new SubscriptionsController(service, gateway);
      const res = mockRes();
      const body = { event: 'subscription.activated' };
      const req = {
        id: 'req-1',
        rawBody: Buffer.from(JSON.stringify(body)),
        body,
        header: vi.fn().mockReturnValue('valid-signature'),
      } as unknown as Request;

      controller.webhook(req, res, next);
      await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

      expect(gateway.verifyWebhookSignature).toHaveBeenCalledWith(
        JSON.stringify(body),
        'valid-signature'
      );
      expect(service.handleWebhookEvent).toHaveBeenCalledWith(body);
      expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual({ received: true });
    });

    it('rejects with 401 when the signature is missing', async () => {
      const service = { handleWebhookEvent: vi.fn() } as unknown as SubscriptionsService;
      const gateway = buildGateway();
      const controller = new SubscriptionsController(service, gateway);
      const res = mockRes();
      const req = {
        id: 'req-1',
        rawBody: Buffer.from('{}'),
        body: {},
        header: vi.fn().mockReturnValue(undefined),
      } as unknown as Request;

      controller.webhook(req, res, next);
      await vi.waitFor(() => expect(next).toHaveBeenCalled());

      expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ statusCode: 401 });
      expect(gateway.verifyWebhookSignature).not.toHaveBeenCalled();
      expect(service.handleWebhookEvent).not.toHaveBeenCalled();
    });

    it('rejects with 401 when the signature does not verify', async () => {
      const service = { handleWebhookEvent: vi.fn() } as unknown as SubscriptionsService;
      const gateway = buildGateway({ verifyWebhookSignature: vi.fn().mockReturnValue(false) });
      const controller = new SubscriptionsController(service, gateway);
      const res = mockRes();
      const req = {
        id: 'req-1',
        rawBody: Buffer.from('{}'),
        body: {},
        header: vi.fn().mockReturnValue('bad-signature'),
      } as unknown as Request;

      controller.webhook(req, res, next);
      await vi.waitFor(() => expect(next).toHaveBeenCalled());

      expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ statusCode: 401 });
      expect(service.handleWebhookEvent).not.toHaveBeenCalled();
    });

    it('treats a missing raw body as an empty string rather than throwing', async () => {
      const service = { handleWebhookEvent: vi.fn() } as unknown as SubscriptionsService;
      const gateway = buildGateway({ verifyWebhookSignature: vi.fn().mockReturnValue(false) });
      const controller = new SubscriptionsController(service, gateway);
      const res = mockRes();
      const req = {
        id: 'req-1',
        rawBody: undefined,
        body: {},
        header: vi.fn().mockReturnValue('some-signature'),
      } as unknown as Request;

      controller.webhook(req, res, next);
      await vi.waitFor(() => expect(next).toHaveBeenCalled());

      expect(gateway.verifyWebhookSignature).toHaveBeenCalledWith('', 'some-signature');
    });
  });
});
