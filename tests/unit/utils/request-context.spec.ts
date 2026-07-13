import { getRequestId, runWithRequestContext } from '@utils/request-context';

describe('request-context', () => {
  it('returns undefined when called outside any request context', () => {
    expect(getRequestId()).toBeUndefined();
  });

  it('exposes the request id inside runWithRequestContext', () => {
    const seen = runWithRequestContext({ requestId: 'req-1' }, () => getRequestId());
    expect(seen).toBe('req-1');
  });

  it('does not leak the context outside the callback', () => {
    runWithRequestContext({ requestId: 'req-2' }, () => getRequestId());
    expect(getRequestId()).toBeUndefined();
  });

  it('propagates the id across an async call chain', async () => {
    const seen = await runWithRequestContext({ requestId: 'req-3' }, async () => {
      await Promise.resolve();
      return getRequestId();
    });
    expect(seen).toBe('req-3');
  });
});
