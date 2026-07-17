import { resolveCorsOptions } from '@middleware/cors';

describe('resolveCorsOptions', () => {
  it('reflects the request origin (credentialed) when no allowlist is set', () => {
    expect(resolveCorsOptions(undefined)).toEqual({ origin: true, credentials: true });
    expect(resolveCorsOptions('')).toEqual({ origin: true, credentials: true });
    expect(resolveCorsOptions('  ,  ')).toEqual({ origin: true, credentials: true });
  });

  it('restricts to the configured origins, trimming whitespace and blanks', () => {
    expect(resolveCorsOptions('https://a.com')).toEqual({
      origin: ['https://a.com'],
      credentials: true,
    });
    expect(resolveCorsOptions(' https://a.com , https://b.com ,')).toEqual({
      origin: ['https://a.com', 'https://b.com'],
      credentials: true,
    });
  });
});
