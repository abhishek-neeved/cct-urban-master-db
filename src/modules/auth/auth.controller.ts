import { Request, RequestHandler, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AuthService } from './auth.service';
import { asyncHandler } from '@middleware/async-handler';
import { success } from '@models/api-response';
import { setAuthCookies, clearAuthCookies } from '@utils/cookie.util';
import { REFRESH_TOKEN_COOKIE } from '@config/constants';
import { UnauthorizedError } from '@utils/errors';

/** Prefers the `refreshToken` cookie (browser clients); falls back to the body
 * (non-browser clients) — see auth.validator's now-optional `refreshTokenSchema`. */
const readRefreshToken = (req: Request): string => {
  const token = req.cookies?.[REFRESH_TOKEN_COOKIE] ?? req.body.refreshToken;
  if (!token) {
    throw new UnauthorizedError('Refresh token is required (cookie or body)');
  }
  return token;
};

/**
 * Auth HTTP handlers. Request bodies/queries are validated upstream by the
 * `validate` middleware, so these read already-validated data and just map
 * service results to responses. `asyncHandler` forwards any thrown error to the
 * central error handler, so no try/catch is needed here.
 */
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  register: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const { user, devOtp } = await this.authService.register(req.body);
    const data: Record<string, unknown> = { user };
    // Dev-only convenience so the flow can be exercised without a mail server.
    if (devOtp) data.otpDevCode = devOtp;
    res.status(StatusCodes.CREATED).json(success(data, req.id));
  });

  verifyOtp: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    await this.authService.verifyOtp(req.body.email, req.body.otp);
    res.status(StatusCodes.OK).json(success({ verified: true }, req.id));
  });

  resendOtp: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const devOtp = await this.authService.resendOtp(req.body.email);
    const data: Record<string, unknown> = {
      message: 'If the account exists and is unverified, a new code has been sent',
    };
    // Dev-only convenience so the flow can be exercised without a mail server.
    if (devOtp) data.otpDevCode = devOtp;
    res.status(StatusCodes.OK).json(success(data, req.id));
  });

  login: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const { user, tokens } = await this.authService.login(req.body);
    setAuthCookies(res, tokens);
    res.status(StatusCodes.OK).json(success({ user, ...tokens }, req.id));
  });

  me: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const user = await this.authService.getProfile(req.userId as string);
    res.status(StatusCodes.OK).json(success({ user }, req.id));
  });

  refresh: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const tokens = await this.authService.refresh(readRefreshToken(req));
    setAuthCookies(res, tokens);
    res.status(StatusCodes.OK).json(success(tokens, req.id));
  });

  logout: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    await this.authService.logout(readRefreshToken(req));
    clearAuthCookies(res);
    res.status(StatusCodes.OK).json(success({ message: 'Logged out' }, req.id));
  });

  forgotPassword: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const devOtp = await this.authService.forgotPassword(req.body.email);
    const data: Record<string, unknown> = {
      message: 'If an account with that email exists, a verification code has been sent',
    };
    // Dev-only convenience so the flow can be exercised without a mail server.
    if (devOtp) data.otpDevCode = devOtp;
    res.status(StatusCodes.OK).json(success(data, req.id));
  });

  resetPassword: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    await this.authService.resetPassword(req.body.email, req.body.otp, req.body.password);
    res.status(StatusCodes.OK).json(success({ message: 'Password has been reset' }, req.id));
  });
}
