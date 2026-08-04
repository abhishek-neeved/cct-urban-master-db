import { Request, RequestHandler, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  OnboardingFeeService,
  type RazorpayPaymentLinkWebhookPayload,
} from './onboarding-fee.service';
import type { IPaymentGateway } from '@shared/services/payment-gateway.service';
import { asyncHandler } from '@middleware/async-handler';
import { success } from '@models/api-response';
import { BadRequestError, UnauthorizedError } from '@utils/errors';
import { env } from '@config/env';

const RAZORPAY_SIGNATURE_HEADER = 'x-razorpay-signature';

/**
 * Onboarding-fee HTTP handlers. Request bodies/queries are validated
 * upstream by the `validate` middleware, so these read already-validated
 * data and just map service results to responses.
 */
export class OnboardingFeeController {
  constructor(
    private readonly onboardingFeeService: OnboardingFeeService,
    private readonly gateway: IPaymentGateway
  ) {}

  me: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const fee = await this.onboardingFeeService.getStatus(req.userId as string);
    res.status(StatusCodes.OK).json(success(fee, req.id));
  });

  checkout: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const { redirectUrl } = req.body as { redirectUrl: string };
    const callbackUrl = `${env.APP_URL}/api/onboarding-fee/callback?redirectUrl=${encodeURIComponent(redirectUrl)}`;
    const result = await this.onboardingFeeService.checkout(req.userId as string, callbackUrl);
    res.status(StatusCodes.OK).json(success(result, req.id));
  });

  /**
   * Razorpay redirects the user's browser/in-app-browser here after payment
   * — not a session request, so the signature (over the exact query params
   * Razorpay appends) is the only trust boundary. On success, redirects on
   * to the caller's own `redirectUrl` rather than rendering anything itself
   * — this endpoint is a pass-through confirmation step, not a UI.
   */
  callback: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as {
      razorpay_payment_id: string;
      razorpay_payment_link_id: string;
      razorpay_payment_link_reference_id: string;
      razorpay_payment_link_status: string;
      razorpay_signature: string;
      redirectUrl: string;
    };

    const verified = this.gateway.verifyPaymentLinkCallback({
      paymentLinkId: query.razorpay_payment_link_id,
      paymentLinkReferenceId: query.razorpay_payment_link_reference_id,
      paymentLinkStatus: query.razorpay_payment_link_status,
      paymentId: query.razorpay_payment_id,
      signature: query.razorpay_signature,
    });
    if (!verified) {
      throw new UnauthorizedError('Invalid payment callback signature');
    }
    if (query.razorpay_payment_link_status !== 'paid') {
      throw new BadRequestError('Payment was not completed');
    }

    await this.onboardingFeeService.confirmCallback(query.razorpay_payment_link_id);
    res.redirect(query.redirectUrl);
  });

  /**
   * Not wrapped in `asyncHandler`'s usual validated-body assumption: the
   * signature check below is itself the validation step, and it must run
   * against the raw body, not the parsed one (see app.ts's `verify` hook).
   * A request with no captured raw body (e.g. an empty body) is treated as
   * failing verification rather than a 500 — either way it's untrusted input.
   */
  webhook: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const signature = req.header(RAZORPAY_SIGNATURE_HEADER);
    const rawBody = req.rawBody?.toString('utf8') ?? '';
    if (!signature || !this.gateway.verifyWebhookSignature(rawBody, signature)) {
      throw new UnauthorizedError('Invalid webhook signature');
    }

    await this.onboardingFeeService.handleWebhookEvent(
      req.body as RazorpayPaymentLinkWebhookPayload
    );
    res.status(StatusCodes.OK).json(success({ received: true }, req.id));
  });
}
