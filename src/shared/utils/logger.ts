import winston from 'winston';
import { env, logFormat } from '@config/env';
import { getRequestId } from './request-context';

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

/**
 * Injects the current request id (if any) from AsyncLocalStorage into every
 * log entry, so logs can be correlated across a single request lifecycle.
 */
const requestIdFormat = winston.format((info) => {
  const requestId = getRequestId();
  if (requestId) {
    info.requestId = requestId;
  }
  return info;
});

const devFormat = printf(({ level, message, timestamp: ts, requestId, stack, ...meta }) => {
  const rid = requestId ? ` [${requestId}]` : '';
  const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${ts}${rid} ${level}: ${stack || message}${extra}`;
});

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: combine(
    errors({ stack: true }),
    requestIdFormat(),
    timestamp(),
    logFormat === 'json' ? json() : combine(colorize(), devFormat)
  ),
  transports: [new winston.transports.Console()],
  silent: env.NODE_ENV === 'test',
});
