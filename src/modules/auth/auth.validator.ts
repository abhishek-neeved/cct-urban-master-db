import { z } from 'zod';

const password = z.string().min(8, 'Password must be at least 8 characters').max(128);

export const registerSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(120),
  lastName: z.string().min(1, 'Last name is required').max(120),
  email: z.string().email('A valid email is required'),
  password,
  // The signup account-type choice — "provide a service" vs. "book a
  // service". `admin` is excluded: never self-registered.
  role: z.enum(['service_provider', 'customer']),
});

export const loginSchema = z.object({
  email: z.string().email('A valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

export const verifyOtpSchema = z.object({
  email: z.string().email('A valid email is required'),
  otp: z.string().regex(/^\d{6}$/, 'OTP must be a 6-digit code'),
});

export const resendOtpSchema = z.object({
  email: z.string().email('A valid email is required'),
});

// Optional: the refresh token may instead arrive via the `refreshToken` cookie
// set by `@utils/cookie.util` (see auth.controller's refresh/logout handlers,
// which reject with 401 if neither the body nor a cookie supplies one).
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required').optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('A valid email is required'),
});

export const resetPasswordSchema = z.object({
  email: z.string().email('A valid email is required'),
  otp: z.string().regex(/^\d{6}$/, 'OTP must be a 6-digit code'),
  password,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: password,
});
