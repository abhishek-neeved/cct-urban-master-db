import { isProduction } from '@config/env';
import { logger } from '@utils/logger';

export interface IEmailService {
  sendPasswordResetEmail(to: string, resetUrl: string): Promise<void>;
}

/**
 * Stub email service: logs the message instead of sending it. Swap this for a
 * real implementation (Nodemailer, SES, Resend, ...) behind the same interface
 * without touching the service layer.
 *
 * The reset URL embeds a live, single-use token, so it is NEVER logged in
 * production (that would put an account-takeover token in the logs). Outside
 * production the full URL is logged as a local-testing convenience.
 */
export class LoggerEmailService implements IEmailService {
  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    if (isProduction) {
      logger.warn(
        `[email:stub] No email transport configured — password-reset email for ${to} was NOT sent. Configure a real IEmailService.`
      );
      return;
    }
    logger.info(`[email:stub] Password reset requested for ${to} → ${resetUrl}`);
  }
}
