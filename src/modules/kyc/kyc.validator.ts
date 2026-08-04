import { z } from 'zod';

// Same patterns as mobile-app's kyc.schema.ts — client and server must never
// disagree on what "valid" means here.
const AADHAR_PATTERN = /^\d{12}$/;
const PAN_PATTERN = /^[A-Z]{5}\d{4}[A-Z]$/;
const OTP_PATTERN = /^\d{6}$/;

export const submitKycSchema = z.object({
  aadharNumber: z.string().regex(AADHAR_PATTERN, 'Aadhar number must be exactly 12 digits'),
  panNumber: z.string().regex(PAN_PATTERN, 'PAN must be in the format ABCDE1234F'),
  address: z.string().min(1, 'Address is required'),
});

export const requestAadharVerificationSchema = z.object({
  aadharNumber: z.string().regex(AADHAR_PATTERN, 'Aadhar number must be exactly 12 digits'),
});

export const verifyAadharOtpSchema = z.object({
  otp: z.string().regex(OTP_PATTERN, 'OTP must be a 6-digit code'),
});

export const requestPanVerificationSchema = z.object({
  panNumber: z.string().regex(PAN_PATTERN, 'PAN must be in the format ABCDE1234F'),
});

export const verifyPanOtpSchema = z.object({
  otp: z.string().regex(OTP_PATTERN, 'OTP must be a 6-digit code'),
});

export const listForReviewQuerySchema = z.object({
  status: z.enum(['pending', 'verified', 'rejected']).optional(),
});

export const userIdParamSchema = z.object({
  userId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'userId must be a valid id'),
});

export const rejectKycSchema = z.object({
  reason: z.string().min(1, 'A rejection reason is required'),
});
