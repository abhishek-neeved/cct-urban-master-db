import { vi } from 'vitest';

// Mutable production flag + a fake logger, both injected via mocks so we can
// assert what the stub email service logs in each environment.
const state = vi.hoisted(() => ({ isProduction: false }));
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));

vi.mock('@config/env', () => ({
  get isProduction() {
    return state.isProduction;
  },
}));
vi.mock('@utils/logger', () => ({ logger: loggerMock }));

const { LoggerEmailService } = await import('@shared/services/email.service');

describe('LoggerEmailService', () => {
  const service = new LoggerEmailService();

  beforeEach(() => {
    loggerMock.info.mockClear();
    loggerMock.warn.mockClear();
  });

  it('logs the reset URL at info level outside production (dev convenience)', async () => {
    state.isProduction = false;
    await service.sendPasswordResetEmail('jane.doe@example.com', 'https://app/reset?token=abc');

    expect(loggerMock.info).toHaveBeenCalledTimes(1);
    expect(loggerMock.info.mock.calls[0][0]).toContain('https://app/reset?token=abc');
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it('never logs the token URL in production, only a warning that no transport is configured', async () => {
    state.isProduction = true;
    await service.sendPasswordResetEmail('jane.doe@example.com', 'https://app/reset?token=secret');

    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn.mock.calls[0][0]).not.toContain('secret');
    expect(loggerMock.info).not.toHaveBeenCalled();
  });
});
