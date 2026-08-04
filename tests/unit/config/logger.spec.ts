import { Writable } from 'node:stream';
import winston from 'winston';

// The logger is built at import time from the current env. To assert on its
// formatted output we attach a capturing Stream transport (the logger-level
// format applies to every transport, so it sees the fully formatted line).
const flush = () => new Promise((resolve) => setImmediate(resolve));

const attachCapture = (logger: winston.Logger) => {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  const transport = new winston.transports.Stream({ stream: sink });
  logger.add(transport);
  return { output: () => chunks.join(''), detach: () => logger.remove(transport) };
};

describe('logger', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('development format includes the request id, extra meta, and error stacks', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('LOG_LEVEL', 'debug');
    const { logger } = await import('@utils/logger');
    const { runWithRequestContext } = await import('@utils/request-context');

    const cap = attachCapture(logger);
    logger.info('plain message', { userId: 'u-1' });
    runWithRequestContext({ requestId: 'rid-9' }, () => logger.info('with request id'));
    logger.error(new Error('boom'));
    await flush();
    cap.detach();

    const out = cap.output();
    expect(out).toContain('rid-9'); // requestIdFormat injected it
    expect(out).toContain('userId'); // meta rendered
    expect(out).toContain('boom'); // error stack/message rendered
  });

  it('production format emits structured JSON', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_ACCESS_SECRET', 'x'.repeat(40));
    vi.stubEnv('CORS_ORIGINS', 'https://app.example.com');
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_live_real');
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'a-real-secret');
    vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', 'a-real-webhook-secret');
    vi.stubEnv('MOBILE_VERIFICATION_API_KEY', 'a-real-mobile-verification-api-key');
    const { logger } = await import('@utils/logger');

    const cap = attachCapture(logger);
    logger.info('prod line');
    await flush();
    cap.detach();

    expect(cap.output()).toContain('"message":"prod line"');
  });

  it('LOG_FORMAT overrides the environment default (json in development)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('LOG_FORMAT', 'json');
    const { logger } = await import('@utils/logger');

    const cap = attachCapture(logger);
    logger.info('override line');
    await flush();
    cap.detach();

    expect(cap.output()).toContain('"message":"override line"');
  });
});
