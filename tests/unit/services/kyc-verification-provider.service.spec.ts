import { vi } from 'vitest';

// Mutable production flag + a fake logger, both injected via mocks so we can
// assert what the stub provider logs in each environment — mirrors
// email.service.spec.ts's pattern exactly.
const state = vi.hoisted(() => ({ isProduction: false }));
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));

vi.mock('@config/env', () => ({
  get isProduction() {
    return state.isProduction;
  },
}));
vi.mock('@utils/logger', () => ({ logger: loggerMock }));

const { MockKycVerificationProvider } = await import('@shared/services/kyc-verification.service');

describe('MockKycVerificationProvider', () => {
  const provider = new MockKycVerificationProvider();

  beforeEach(() => {
    loggerMock.info.mockClear();
    loggerMock.warn.mockClear();
  });

  describe('requestAadharVerification', () => {
    it('returns a masked mobile number and the raw OTP outside production', async () => {
      state.isProduction = false;

      const result = await provider.requestAadharVerification('123456789012');

      expect(result.maskedMobileNumber).toBe('9XXXXX9012');
      expect(result.devOtp).toMatch(/^\d{6}$/);
      expect(loggerMock.info).toHaveBeenCalledTimes(1);
      expect(loggerMock.info.mock.calls[0][0]).toContain(result.devOtp);
      expect(loggerMock.warn).not.toHaveBeenCalled();
    });

    it('never returns the OTP in production, only a masked mobile number and a warning', async () => {
      state.isProduction = true;

      const result = await provider.requestAadharVerification('123456789012');

      expect(result.maskedMobileNumber).toBe('9XXXXX9012');
      expect(result.devOtp).toBeUndefined();
      expect(loggerMock.warn).toHaveBeenCalledTimes(1);
      expect(loggerMock.info).not.toHaveBeenCalled();
    });
  });

  describe('requestPanVerification', () => {
    it('returns a masked mobile number and the raw OTP outside production', async () => {
      state.isProduction = false;

      const result = await provider.requestPanVerification('ABCDE1234F');

      expect(result.maskedMobileNumber).toBe('9XXXXX234F');
      expect(result.devOtp).toMatch(/^\d{6}$/);
      expect(loggerMock.info).toHaveBeenCalledTimes(1);
      expect(loggerMock.info.mock.calls[0][0]).toContain(result.devOtp);
      expect(loggerMock.warn).not.toHaveBeenCalled();
    });

    it('never returns the OTP in production, only a masked mobile number and a warning', async () => {
      state.isProduction = true;

      const result = await provider.requestPanVerification('ABCDE1234F');

      expect(result.maskedMobileNumber).toBe('9XXXXX234F');
      expect(result.devOtp).toBeUndefined();
      expect(loggerMock.warn).toHaveBeenCalledTimes(1);
      expect(loggerMock.info).not.toHaveBeenCalled();
    });
  });
});
