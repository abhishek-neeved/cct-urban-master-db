import { Router } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoggerEmailService } from '@shared/services/email.service';
import { UserRepository } from './user.repository';
import { RefreshTokenRepository } from './refresh-token.repository';
import { validate } from '@middleware/validate';
import { requireAuth } from '@middleware/require-auth';
import { authLimiter } from '@middleware/rate-limit';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  resetPasswordSchema,
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
  const emailService = new LoggerEmailService();
  const authService = new AuthService(users, refreshTokens, emailService);
  const controller = new AuthController(authService);

  const router = Router();

  /**
   * @openapi
   * /api/auth/register:
   *   post:
   *     tags: [Auth]
   *     summary: Register a new account and receive tokens
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/RegisterRequest' }
   *     responses:
   *       201:
   *         description: Created
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/AuthPayload' }
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
   *         description: OK
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/AuthPayload' }
   *       401: { description: Invalid email or password }
   *       422: { description: Validation failed }
   *       429: { description: Too many requests }
   */
  router.post('/login', authLimiter, validate({ body: loginSchema }), controller.login);

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
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/RefreshTokenRequest' }
   *     responses:
   *       200:
   *         description: OK
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
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/RefreshTokenRequest' }
   *     responses:
   *       200: { description: Logged out }
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
