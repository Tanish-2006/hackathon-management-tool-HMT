import { z } from 'zod';

// E.164: leading +, country code, 8-15 digits total (same rule as participant-api).
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  fullName: z.string().min(1).max(100).optional(),
  displayName: z.string().min(1).max(100).optional(),
  role: z.enum(['ORGANIZER', 'MENTOR', 'ADMIN', 'PARTICIPANT']).optional(), // server validates
  // Phase 1 phone identity: ONE verified phone number = ONE HMT identity.
  phoneNumber: z.string().regex(E164_PATTERN, 'phoneNumber must be in E.164 format (e.g. +919876543210)'),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export const requestPhoneOtpSchema = z.object({
  phoneNumber: z.string().regex(E164_PATTERN, 'phoneNumber must be in E.164 format (e.g. +919876543210)'),
});

export const verifyPhoneSchema = z.object({
  phoneNumber: z.string().regex(E164_PATTERN, 'phoneNumber must be in E.164 format (e.g. +919876543210)'),
  otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type RequestPhoneOtpInput = z.infer<typeof requestPhoneOtpSchema>;
export type VerifyPhoneInput = z.infer<typeof verifyPhoneSchema>;
