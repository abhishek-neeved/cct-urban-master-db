import { vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { OnboardingFeeController } from '@modules/onboarding-fee/onboarding-fee.controller';
import type { OnboardingFeeService } from '@modules/onboarding-fee/onboarding-fee.service';
import type { IPaymentGateway } from '@shared/services/payment-gateway.service';

const mockRes = () =>
  ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
  }) as unknown as Response;
const next = vi.fn() as NextFunction;

const buildGateway = (overrides: Partial<IPaymentGateway> = {}): IPaymentGateway =>
  ({
    createPaymentLink: vi.fn(),
    verifyWebhookSignature: vi.fn(),
    verifyPaymentLinkCallback: vi.fn(),
    ...overrides,
  }) as IPaymentGateway;

describe('OnboardingFeeController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('me returns the status for the authenticated user', async () => {
    const fee = { status: 'unpaid' as const, amountInRupees: 10 };
    const service = {
      getStatus: vi.fn().mockResolvedValue(fee),
    } as unknown as OnboardingFeeService;
    const controller = new OnboardingFeeController(service, buildGateway());
    const res = mockRes();

    controller.me({ id: 'req-1', userId: 'u1' } as Request, res, next);
    await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

    expect(service.getStatus).toHaveBeenCalledWith('u1');
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual(fee);
  });

  describe('checkout', () => {
    it('builds the callback URL from APP_URL + the given redirectUrl and returns the checkout result', async () => {
      const result = { shortUrl: 'https://rzp.io/i/abc' };
      const service = {
        checkout: vi.fn().mockResolvedValue(result),
      } as unknown as OnboardingFeeService;
      const controller = new OnboardingFeeController(service, buildGateway());
      const res = mockRes();
      const req = {
        id: 'req-1',
        userId: 'u1',
        body: { redirectUrl: 'https://app.example.com/done' },
      } as unknown as Request;

      controller.checkout(req, res, next);
      await vi.waitFor(() => expect(res.json).toHaveBeenCalled());

      expect(service.checkout).toHaveBeenCalledWith(
        'u1',
        expect.stringContaining('/api/onboarding-fee/callback?redirectUrl=')
      );
      const [, callbackUrl] = (service.checkout as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
      ];
      expect(callbackUrl).toContain(encodeURIComponent('https://app.example.com/done'));
      expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual(result);
    });
  });

  describe('callback', () => {
    const buildQuery = (overrides: Record<string, string> = {}) => ({
      razorpay_payment_id: 'pay_1',
      razorpay_payment_link_id: 'plink_1',
      razorpay_payment_link_reference_id: 'u1',
      razorpay_payment_link_status: 'paid',
      razorpay_signature: 'sig123',
      redirectUrl: 'https://app.example.com/done',
      ...overrides,
    });

    it('confirms and redirects on a valid signature with a paid status', async () => {
      const service = {
        confirmCallback: vi.fn().mockResolvedValue(undefined),
      } as unknown as OnboardingFeeService;
      const gateway = buildGateway({ verifyPaymentLinkCallback: vi.fn().mockReturnValue(true) });
      const controller = new OnboardingFeeController(service, gateway);
      const res = mockRes();
      const req = { id: 'req-1', query: buildQuery() } as unknown as Request;

      controller.callback(req, res, next);
      await vi.waitFor(() => expect(res.redirect).toHaveBeenCalled());

      expect(gateway.verifyPaymentLinkCallback).toHaveBeenCalledWith({
        paymentLinkId: 'plink_1',
        paymentLinkReferenceId: 'u1',
        paymentLinkStatus: 'paid',
        paymentId: 'pay_1',
        signature: 'sig123',
      });
      expect(service.confirmCallback).toHaveBeenCalledWith('plink_1');
      expect(res.redirect).toHaveBeenCalledWith('https://app.example.com/done');
    });

    it('rejects with 401 when the signature does not verify', async () => {
      const service = { confirmCallback: vi.fn() } as unknown as OnboardingFeeService;
      const gateway = buildGateway({ verifyPaymentLinkCallback: vi.fn().mockReturnValue(false) });
      const controller = new OnboardingFeeController(service, gateway);
      const res = mockRes();
      const req = { id: 'req-1', query: buildQuery() } as unknown as Request;

      controller.callback(req, res, next);
      await vi.waitFor(() => expect(next).toHaveBeenCalled());

      expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
        statusCode: 401,
      });
      expect(service.confirmCallback).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it('rejects with 400 when the signature is valid but the status is not paid', async () => {
      const service = { confirmCallback: vi.fn() } as unknown as OnboardingFeeService;
      const gateway = buildGateway({ verifyPaymentLinkCallback: vi.fn().mockReturnValue(true) });
      const controller = new OnboardingFeeController(service, gateway);
      const res = mockRes();
      const req = {
        id: 'req-1',
        query: buildQuery({ razorpay_payment_link_status: 'cancelled' }),
      } as unknown as Request;

      controller.callback(req, res, next);
      await vi.waitFor(() => expect(next).toHaveBeenCalled());

      expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
        statusCode: 400,
      });
      expect(service.confirmCallback).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    });
  });

  describe('webhook', () => {
    it('verifies the signature against the raw body and applies the event on success', async () => {
      const service = {
        handleWebhookEvent: vi.fn().mockResolvedValue(undefined),
      } as unknown as OnboardingFeeService;
      const gateway = buildGateway({ verifyWebhookSignature: vi.fn().mockReturnValue(true) });
      const controller = new OnboardingFeeController(service, gateway);
      const res = mockRes();
      const body = { event: 'payment_link.paid' };
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
      expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual({
        received: true,
      });
    });

    it('rejects with 401 when the signature is missing', async () => {
      const service = { handleWebhookEvent: vi.fn() } as unknown as OnboardingFeeService;
      const gateway = buildGateway();
      const controller = new OnboardingFeeController(service, gateway);
      const res = mockRes();
      const req = {
        id: 'req-1',
        rawBody: Buffer.from('{}'),
        body: {},
        header: vi.fn().mockReturnValue(undefined),
      } as unknown as Request;

      controller.webhook(req, res, next);
      await vi.waitFor(() => expect(next).toHaveBeenCalled());

      expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
        statusCode: 401,
      });
      expect(gateway.verifyWebhookSignature).not.toHaveBeenCalled();
      expect(service.handleWebhookEvent).not.toHaveBeenCalled();
    });

    it('rejects with 401 when the signature does not verify', async () => {
      const service = { handleWebhookEvent: vi.fn() } as unknown as OnboardingFeeService;
      const gateway = buildGateway({ verifyWebhookSignature: vi.fn().mockReturnValue(false) });
      const controller = new OnboardingFeeController(service, gateway);
      const res = mockRes();
      const req = {
        id: 'req-1',
        rawBody: Buffer.from('{}'),
        body: {},
        header: vi.fn().mockReturnValue('bad-signature'),
      } as unknown as Request;

      controller.webhook(req, res, next);
      await vi.waitFor(() => expect(next).toHaveBeenCalled());

      expect((next as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
        statusCode: 401,
      });
      expect(service.handleWebhookEvent).not.toHaveBeenCalled();
    });

    it('treats a missing raw body as an empty string rather than throwing', async () => {
      const service = { handleWebhookEvent: vi.fn() } as unknown as OnboardingFeeService;
      const gateway = buildGateway({ verifyWebhookSignature: vi.fn().mockReturnValue(false) });
      const controller = new OnboardingFeeController(service, gateway);
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
