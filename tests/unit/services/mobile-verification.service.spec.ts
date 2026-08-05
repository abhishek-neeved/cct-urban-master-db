import { vi } from 'vitest';
import { env } from '@config/env';
import { HttpMobileVerificationProvider } from '@shared/services/mobile-verification.service';
import { BadRequestError, ServiceUnavailableError } from '@utils/errors';

const buildResponse = (overrides: Partial<Response> & { body?: unknown } = {}): Response => {
  const { body, ...rest } = overrides;
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body ?? { success: true, data: {} }),
    ...rest,
  } as unknown as Response;
};

describe('HttpMobileVerificationProvider', () => {
  const provider = new HttpMobileVerificationProvider();
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a POST request with the X-API-KEY header and mobile_number body, returning body.data on success', async () => {
    const data = {
      pan_number: 'ABCDE1234F',
      full_name: 'Test User',
      masked_aadhaar: 'XXXXXXXX9012',
      address: { full: '221B Baker Street' },
    };
    fetchMock.mockResolvedValue(buildResponse({ body: { success: true, data } }));

    const result = await provider.lookupByMobileNumber('9876543210');

    expect(result).toEqual(data);
    expect(fetchMock).toHaveBeenCalledWith(
      env.MOBILE_VERIFICATION_API_URL,
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': env.MOBILE_VERIFICATION_API_KEY,
        },
        body: JSON.stringify({ mobile_number: '9876543210' }),
      })
    );
  });

  it('throws ServiceUnavailableError when fetch itself throws (network error)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(provider.lookupByMobileNumber('9876543210')).rejects.toThrow(
      ServiceUnavailableError
    );
  });

  it('throws BadRequestError with the API message when the response is not ok', async () => {
    fetchMock.mockResolvedValue(
      buildResponse({
        ok: false,
        status: 400,
        body: { success: false, message: 'Bad mobile number' },
      })
    );

    await expect(provider.lookupByMobileNumber('9876543210')).rejects.toThrow(BadRequestError);
    await expect(provider.lookupByMobileNumber('9876543210')).rejects.toThrow('Bad mobile number');
  });

  it('throws BadRequestError when success is false even if the response is ok', async () => {
    fetchMock.mockResolvedValue(
      buildResponse({ body: { success: false, message: 'Mobile number not found' } })
    );

    await expect(provider.lookupByMobileNumber('9876543210')).rejects.toThrow(BadRequestError);
    await expect(provider.lookupByMobileNumber('9876543210')).rejects.toThrow(
      'Mobile number not found'
    );
  });

  it('throws BadRequestError when data is missing even if success is true', async () => {
    fetchMock.mockResolvedValue(buildResponse({ body: { success: true } }));

    await expect(provider.lookupByMobileNumber('9876543210')).rejects.toThrow(BadRequestError);
  });

  it('falls back to a generic message when the API response has no message', async () => {
    fetchMock.mockResolvedValue(buildResponse({ ok: false, status: 500, body: null }));

    await expect(provider.lookupByMobileNumber('9876543210')).rejects.toThrow(
      'Could not verify this mobile number'
    );
  });

  it('falls back to a generic message when the body cannot be parsed as JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockRejectedValue(new Error('invalid json')),
    } as unknown as Response);

    await expect(provider.lookupByMobileNumber('9876543210')).rejects.toThrow(
      'Could not verify this mobile number'
    );
  });
});
