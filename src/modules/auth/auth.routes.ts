import { Router } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoggerEmailService } from '@shared/services/email.service';
import { UserRepository } from './user.repository';
import { RefreshTokenRepository } from './refresh-token.repository';
import { OtpRepository } from './otp.repository';
import { LoginAttemptRepository } from './login-attempt.repository';
import { validate } from '@middleware/validate';
import { requireAuth } from '@middleware/require-auth';
import { authLimiter } from '@middleware/rate-limit';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  resendOtpSchema,
  resetPasswordSchema,
  verifyOtpSchema,
  verifyResetTokenQuerySchema,
} from './auth.validator';

/**
 * Auth feature module: wires its own layers (repositories -> service ->
 * controller) and returns the mounted router. Keeping the wiring here — next to
 * the routes it serves — means the top-level router stays a thin mount table.
 */
export const createAuthModule = (): Router => {
  const users = new UserRepository();
  const refreshTokens = new RefreshTokenRepository();
  const otps = new OtpRepository();
  const loginAttempts = new LoginAttemptRepository();
  const emailService = new LoggerEmailService();
  const authService = new AuthService(users, refreshTokens, otps, loginAttempts, emailService);
  const controller = new AuthController(authService);

  const router = Router();

  /**
   * @openapi
   * /api/auth/register:
   *   post:
   *     tags: [Auth]
   *     summary: Register a new account (does not log in — no tokens are issued)
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/RegisterRequest' }
   *     responses:
   *       201:
   *         description: Created — a 6-digit verification OTP has been emailed
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 user: { $ref: '#/components/schemas/User' }
   *       409: { description: Email already registered }
   *       422: { description: Validation failed }
   *       429: { description: Too many requests }
   */
  // Credential endpoints are rate-limited to blunt brute-force / enumeration.
  router.post('/register', authLimiter, validate({ body: registerSchema }), controller.register);

  /**
   * @openapi
   * /api/auth/login:
   *   post:
   *     tags: [Auth]
   *     summary: Log in with email and password
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/LoginRequest' }
   *     responses:
   *       200:
   *         description: >
   *           OK — also sets httpOnly `accessToken`/`refreshToken` cookies
   *           (see the `cookieAuth` security scheme); the tokens are returned
   *           in the body too, for non-browser clients.
   *         headers:
   *           Set-Cookie: { schema: { type: string }, description: "accessToken and refreshToken (httpOnly)" }
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/AuthPayload' }
   *       401: { description: Invalid email or password }
   *       403: { description: Account not verified }
   *       422: { description: Validation failed }
   *       429: { description: Too many requests }
   */
  router.post('/login', authLimiter, validate({ body: loginSchema }), controller.login);

  /**
   * @openapi
   * /api/auth/verify-otp:
   *   post:
   *     tags: [Auth]
   *     summary: Verify an account with the emailed OTP
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/VerifyOtpRequest' }
   *     responses:
   *       200:
   *         description: Account verified
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 verified: { type: boolean, example: true }
   *       400: { description: Invalid or expired verification code }
   *       422: { description: Validation failed }
   *       429: { description: Too many requests }
   */
  router.post(
    '/verify-otp',
    authLimiter,
    validate({ body: verifyOtpSchema }),
    controller.verifyOtp
  );

  /**
   * @openapi
   * /api/auth/resend-otp:
   *   post:
   *     tags: [Auth]
   *     summary: Resend a verification OTP (always 200 — no account enumeration)
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/ResendOtpRequest' }
   *     responses:
   *       200: { description: A new code has been sent if the account exists and is unverified }
   *       422: { description: Validation failed }
   *       429: { description: Too many requests }
   */
  router.post(
    '/resend-otp',
    authLimiter,
    validate({ body: resendOtpSchema }),
    controller.resendOtp
  );

  /**
   * @openapi
   * /api/auth/forgot-password:
   *   post:
   *     tags: [Auth]
   *     summary: Request a password-reset link (always 200 — no account enumeration)
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/ForgotPasswordRequest' }
   *     responses:
   *       200: { description: Reset link sent if the account exists }
   *       429: { description: Too many requests }
   */
  router.post(
    '/forgot-password',
    authLimiter,
    validate({ body: forgotPasswordSchema }),
    controller.forgotPassword
  );

  /**
   * @openapi
   * /api/auth/reset-password:
   *   post:
   *     tags: [Auth]
   *     summary: Set a new password using a valid reset token
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/ResetPasswordRequest' }
   *     responses:
   *       200: { description: Password has been reset }
   *       400: { description: Invalid or expired reset token }
   *       422: { description: Validation failed }
   */
  router.post(
    '/reset-password',
    authLimiter,
    validate({ body: resetPasswordSchema }),
    controller.resetPassword
  );

  /**
   * @openapi
   * /api/auth/refresh:
   *   post:
   *     tags: [Auth]
   *     summary: Exchange a refresh token for a new (rotated) token pair
   *     description: >
   *       Reads the refresh token from the `refreshToken` cookie if present,
   *       otherwise from the request body.
   *     requestBody:
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/RefreshTokenRequest' }
   *     responses:
   *       200:
   *         description: OK — also re-sets the rotated httpOnly auth cookies.
   *         headers:
   *           Set-Cookie: { schema: { type: string }, description: "accessToken and refreshToken (httpOnly)" }
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/TokenPair' }
   *       401: { description: Invalid or expired refresh token }
   */
  router.post('/refresh', validate({ body: refreshTokenSchema }), controller.refresh);

  /**
   * @openapi
   * /api/auth/logout:
   *   post:
   *     tags: [Auth]
   *     summary: Revoke a refresh token
   *     description: >
   *       Reads the refresh token from the `refreshToken` cookie if present,
   *       otherwise from the request body.
   *     requestBody:
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/RefreshTokenRequest' }
   *     responses:
   *       200:
   *         description: Logged out — also clears the httpOnly auth cookies.
   */
  router.post('/logout', validate({ body: refreshTokenSchema }), controller.logout);

  /**
   * @openapi
   * /api/auth/verify-forgot-password-token:
   *   get:
   *     tags: [Auth]
   *     summary: Check whether a password-reset token is valid
   *     parameters:
   *       - in: query
   *         name: token
   *         required: true
   *         schema: { type: string, minLength: 1 }
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 valid: { type: boolean }
   */
  router.get(
    '/verify-forgot-password-token',
    validate({ query: verifyResetTokenQuerySchema }),
    controller.verifyForgotPasswordToken
  );

  /**
   * @openapi
   * /api/auth/me:
   *   get:
   *     tags: [Auth]
   *     summary: Get the authenticated user (requires access token)
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 user: { $ref: '#/components/schemas/User' }
   *       401: { description: Missing/invalid access token }
   */
  // Protected: requires a valid access token.
  router.get('/me', requireAuth, controller.me);

  return router;
};
