import { env } from '@config/env';
import { logger } from '@utils/logger';
import { BadRequestError, ServiceUnavailableError } from '@utils/errors';

/**
 * The subset of CoinCircleTrust's mobile-to-pan response this app persists.
 * Field names mirror the third-party API's own snake_case exactly (not
 * remapped to camelCase) so a raw response can be stored/compared verbatim —
 * see `MobileVerifiedDocumentModel`.
 */
export interface MobileToPanResult {
  pan_number: string;
  full_name: string;
  masked_aadhaar: string;
  address: {
    full: string;
    city?: string;
    state?: string;
    country?: string;
    zip?: string;
  };
  email?: string;
  phone_number?: string;
  gender?: string;
  dob?: string;
  aadhaar_linked?: boolean;
}

/**
 * Abstraction over CoinCircleTrust's mobile-number-to-identity lookup — a
 * real, billed third-party API (not a mock). This provider fetches actual
 * identity data; the OTP that proves the user owns the mobile number is
 * still ours to generate and check (see `KycService`), exactly like every
 * other OTP flow in this app.
 */
export interface IMobileVerificationProvider {
  lookupByMobileNumber(mobileNumber: string): Promise<MobileToPanResult>;
}

/**
 * HTTP client for CoinCircleTrust's API-product platform. Kept behind
 * `IMobileVerificationProvider` (rather than services calling `fetch`
 * directly) so `MobileVerificationService` can be unit-tested against a
 * plain mock instead of a real/mocked HTTP call.
 */
export class HttpMobileVerificationProvider implements IMobileVerificationProvider {
  async lookupByMobileNumber(mobileNumber: string): Promise<MobileToPanResult> {
    let response: Response;
    try {
      response = await fetch(env.MOBILE_VERIFICATION_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': env.MOBILE_VERIFICATION_API_KEY,
        },
        body: JSON.stringify({ mobile_number: mobileNumber }),
      });
    } catch (error) {
      logger.error('Mobile verification API unreachable', { error });
      throw new ServiceUnavailableError('Mobile verification is temporarily unavailable');
    }

    const body = (await response.json().catch(() => null)) as {
      success?: boolean;
      message?: string;
      data?: MobileToPanResult;
    } | null;

    if (!response.ok || !body?.success || !body.data) {
      logger.warn('Mobile verification API rejected the request', {
        status: response.status,
        message: body?.message,
      });
      throw new BadRequestError(body?.message ?? 'Could not verify this mobile number');
    }

    return body.data;
  }
}
