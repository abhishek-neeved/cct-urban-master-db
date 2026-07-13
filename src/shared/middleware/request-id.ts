import { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { runWithRequestContext } from '@utils/request-context';

const REQUEST_ID_HEADER = 'x-request-id';

// Only accept incoming ids that are safe to echo into a header and a log line.
// Anything else (control chars, absurd length, injection attempts) is replaced
// with a freshly generated id.
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Assigns a unique id to every request (honouring a well-formed incoming
 * X-Request-Id if present), echoes it back in the response header, and stores
 * it in AsyncLocalStorage so the logger can pick it up anywhere in the call chain.
 */
export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const incoming = req.header(REQUEST_ID_HEADER);
  const requestId = incoming && VALID_REQUEST_ID.test(incoming) ? incoming : uuidv4();

  req.id = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);

  runWithRequestContext({ requestId }, () => next());
};
