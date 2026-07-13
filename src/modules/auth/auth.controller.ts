import { Request, RequestHandler, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AuthService } from './auth.service';
import { asyncHandler } from '@middleware/async-handler';
import { success } from '@models/api-response';

/**
 * Auth HTTP handlers. Request bodies/queries are validated upstream by the
 * `validate` middleware, so these read already-validated data and just map
 * service results to responses. `asyncHandler` forwards any thrown error to the
 * central error handler, so no try/catch is needed here.
 */
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  register: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const { user, tokens } = await this.authService.register(req.body);
    res.status(StatusCodes.CREATED).json(success({ user, ...tokens }, req.id));
  });

  login: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const { user, tokens } = await this.authService.login(req.body);
    res.status(StatusCodes.OK).json(success({ user, ...tokens }, req.id));
  });

  me: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const user = await this.authService.getProfile(req.userId as string);
    res.status(StatusCodes.OK).json(success({ user }, req.id));
  });

  refresh: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const tokens = await this.authService.refresh(req.body.refreshToken);
    res.status(StatusCodes.OK).json(success(tokens, req.id));
  });

  logout: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    await this.authService.logout(req.body.refreshToken);
    res.status(StatusCodes.OK).json(success({ message: 'Logged out' }, req.id));
  });

  forgotPassword: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const devToken = await this.authService.forgotPassword(req.body.email);
    const data: Record<string, unknown> = {
      message: 'If an account with that email exists, a reset link has been sent',
    };
    // Dev-only convenience so the flow can be exercised without a mail server.
    if (devToken) data.resetToken = devToken;
    res.status(StatusCodes.OK).json(success(data, req.id));
  });

  verifyForgotPasswordToken: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const valid = await this.authService.verifyResetToken(String(req.query.token));
    res.status(StatusCodes.OK).json(success({ valid }, req.id));
  });

  resetPassword: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    await this.authService.resetPassword(req.body.token, req.body.password);
    res.status(StatusCodes.OK).json(success({ message: 'Password has been reset' }, req.id));
  });
}
