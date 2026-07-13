import { resolveCorsOptions } from '@middleware/cors';

describe('resolveCorsOptions', () => {
  it('returns undefined (reflect any origin) when no allowlist is set', () => {
    expect(resolveCorsOptions(undefined)).toBeUndefined();
    expect(resolveCorsOptions('')).toBeUndefined();
    expect(resolveCorsOptions('  ,  ')).toBeUndefined();
  });

  it('restricts to the configured origins, trimming whitespace and blanks', () => {
    expect(resolveCorsOptions('https://a.com')).toEqual({ origin: ['https://a.com'] });
    expect(resolveCorsOptions(' https://a.com , https://b.com ,')).toEqual({
      origin: ['https://a.com', 'https://b.com'],
    });
  });
});
