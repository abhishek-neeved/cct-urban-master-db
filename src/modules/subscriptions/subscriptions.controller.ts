import { Request, RequestHandler, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { SubscriptionsService, type RazorpaySubscriptionWebhookPayload } from './subscriptions.service';
import type { IPaymentGateway } from '@shared/services/payment-gateway.service';
import { asyncHandler } from '@middleware/async-handler';
import { success } from '@models/api-response';
import { UnauthorizedError } from '@utils/errors';

const RAZORPAY_SIGNATURE_HEADER = 'x-razorpay-signature';

/**
 * Subscriptions HTTP handlers. Request bodies are validated upstream by the
 * `validate` middleware, so these read already-validated data and just map
 * service results to responses.
 */
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly gateway: IPaymentGateway
  ) {}

  me: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const subscription = await this.subscriptionsService.getStatus(req.userId as string);
    res.status(StatusCodes.OK).json(success(subscription, req.id));
  });

  checkout: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.subscriptionsService.checkout(req.userId as string);
    res.status(StatusCodes.OK).json(success(result, req.id));
  });

  cancel: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    await this.subscriptionsService.cancel(req.userId as string);
    res.status(StatusCodes.OK).json(success({ message: 'Subscription cancelled' }, req.id));
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

    await this.subscriptionsService.handleWebhookEvent(
      req.body as RazorpaySubscriptionWebhookPayload
    );
    res.status(StatusCodes.OK).json(success({ received: true }, req.id));
  });
}
