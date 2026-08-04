import { isProduction } from '@config/env';
import { generateNumericOtp } from '@utils/token.util';
import { logger } from '@utils/logger';

export interface AadharVerificationRequest {
  /** Masked mobile number the OTP was sent to (e.g. "9XXXXX4321"), as a real Aadhaar API would return. */
  maskedMobileNumber: string;
  /** Raw OTP, returned only in non-production so the flow can be tested locally without a real provider. */
  devOtp?: string;
}

export interface PanVerificationRequest {
  /** Masked mobile number the OTP was sent to. */
  maskedMobileNumber: string;
  devOtp?: string;
}

/**
 * Abstraction over a government-id verification provider (e.g. Digilocker,
 * Signzy, Karza, IDfy). Real providers fetch the mobile number linked to an
 * Aadhaar/PAN and text it an OTP — this interface models the "request" side
 * of that round-trip so a real provider can be swapped in later behind the
 * same shape, mirroring `IPaymentGateway`/`IEmailService`. The OTP itself is
 * verified against our own hashed, attempt-capped store
 * (`KycVerificationService`) exactly like every other OTP flow in this app —
 * a provider only ever mints/sends the code, never independently confirms
 * it back to us.
 */
export interface IKycVerificationProvider {
  requestAadharVerification(aadharNumber: string): Promise<AadharVerificationRequest>;
  requestPanVerification(panNumber: string): Promise<PanVerificationRequest>;
}

/**
 * Stub verification provider: generates and logs an OTP instead of calling a
 * real government-id API. Swap this for a real provider behind the same
 * interface without touching the service layer.
 */
export class MockKycVerificationProvider implements IKycVerificationProvider {
  async requestAadharVerification(aadharNumber: string): Promise<AadharVerificationRequest> {
    const maskedMobileNumber = mockLinkedMobileNumber(aadharNumber);
    if (isProduction) {
      logger.warn(
        `[kyc-verification:stub] No real Aadhaar provider configured — OTP for ${aadharNumber} was NOT sent.`
      );
      return { maskedMobileNumber };
    }
    const otp = generateNumericOtp();
    logger.info(`[kyc-verification:stub] Aadhaar OTP for ${aadharNumber} → ${otp}`);
    return { maskedMobileNumber, devOtp: otp };
  }

  async requestPanVerification(panNumber: string): Promise<PanVerificationRequest> {
    const maskedMobileNumber = mockLinkedMobileNumber(panNumber);
    if (isProduction) {
      logger.warn(
        `[kyc-verification:stub] No real PAN provider configured — OTP for ${panNumber} was NOT sent.`
      );
      return { maskedMobileNumber };
    }
    const otp = generateNumericOtp();
    logger.info(`[kyc-verification:stub] PAN OTP for ${panNumber} → ${otp}`);
    return { maskedMobileNumber, devOtp: otp };
  }
}

/** Deterministic placeholder mobile number, masked the way a real provider's response would be. */
const mockLinkedMobileNumber = (docValue: string): string => {
  const lastFour = docValue.slice(-4).padStart(4, '0');
  return `9XXXXX${lastFour}`;
};
