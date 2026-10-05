import { randomUUID, randomInt, createHash } from 'crypto';
import { hashPassword, verifyPassword } from '@hmt/security';
import { createTokenPair, verifyRefreshToken } from '@hmt/security';
import type { JwtConfig } from '@hmt/security';
import { memoryStore } from '../../store/memory.store';
import { E164_PATTERN } from './auth.schemas';
import type { Role } from '@hmt/common';

export interface RegisterData {
  email: string;
  password: string;
  fullName?: string;
  displayName?: string;
  role?: Role;
  // Phase 1 phone identity: ONE verified phone number = ONE HMT identity.
  phoneNumber: string;
}

// Phase 1 phone OTP tuning (overridable via env; same defaults as participant-api).
const OTP_TTL_SEC_DEFAULT = 300;
const OTP_RESEND_COOLDOWN_SEC_DEFAULT = 60;
const OTP_MAX_ATTEMPTS_DEFAULT = 5;

function otpConfig() {
  const num = (key: string, fallback: number) => Number(process.env[key]) || fallback;
  return {
    ttlSec: num('OTP_TTL_SEC', OTP_TTL_SEC_DEFAULT),
    cooldownSec: num('OTP_RESEND_COOLDOWN_SEC', OTP_RESEND_COOLDOWN_SEC_DEFAULT),
    maxAttempts: num('OTP_MAX_ATTEMPTS', OTP_MAX_ATTEMPTS_DEFAULT),
  };
}

export class AuthService {
  constructor(private readonly jwtConfig: JwtConfig) {}

  /**
   * Normalize to E.164: strip spaces/dashes/parens, require leading + country code.
   * Schemas validate the shape; this is defense-in-depth so callers can never
   * store two spellings of the same number (which would break 1-phone-1-identity).
   * Server-side only — never rely on frontend checks.
   */
  private normalizePhoneNumber(raw: string): string {
    const normalized = String(raw ?? '').replace(/[\s\-().]/g, '');
    if (!E164_PATTERN.test(normalized)) {
      throw Object.assign(new Error('phoneNumber must be in E.164 format (e.g. +919876543210)'), {
        statusCode: 400,
      });
    }
    return normalized;
  }

  private hashOtp(otp: string): string {
    return createHash('sha256').update(otp).digest('hex');
  }

  async register(data: RegisterData) {
    const email = data.email.toLowerCase();
    const existing = Array.from(memoryStore.users.values()).find((u) => u.email === email);
    if (existing) {
      throw Object.assign(new Error('Email already registered'), { statusCode: 409 });
    }

    // ONE verified phone = ONE identity: reject a phone claimed by any account,
    // regardless of role (ORGANIZER / MENTOR / ADMIN / PARTICIPANT share this store).
    const phoneNumber = this.normalizePhoneNumber(data.phoneNumber);
    const phoneTaken = Array.from(memoryStore.users.values()).find((u) => u.phoneNumber === phoneNumber);
    if (phoneTaken) {
      throw Object.assign(new Error('Phone number is already registered'), { statusCode: 409 });
    }

    // Server-assigned role with validation: ORGANIZER default, ADMIN requires existing ADMIN or first user
    // Prevent privilege escalation: participant cannot self-register as ADMIN unless allowed via seed
    let role: Role = (data.role as Role) ?? 'ORGANIZER';
    // Only allow ORGANIZER, MENTOR, ADMIN for organizer-api; PARTICIPANT is allowed but not preferred
    const allowedRoles: Role[] = ['ORGANIZER', 'MENTOR', 'ADMIN', 'PARTICIPANT'];
    if (!allowedRoles.includes(role)) role = 'ORGANIZER';

    // If trying to register as ADMIN, check if any ADMIN exists; if exists, deny unless caller is ADMIN (handled at route layer)
    // For simplicity, allow ADMIN registration only if no ADMIN exists yet (first admin seed)
    if (role === 'ADMIN') {
      const hasAdmin = Array.from(memoryStore.users.values()).some((u) => u.role === 'ADMIN');
      if (hasAdmin) {
        throw Object.assign(new Error('ADMIN registration requires an existing admin session'), { statusCode: 403 });
      }
    }

    const passwordHash = await hashPassword(data.password);
    const id = randomUUID();
    const user = {
      id,
      email,
      passwordHash,
      fullName: data.fullName ?? data.displayName ?? email.split('@')[0],
      displayName: data.displayName ?? data.fullName ?? email.split('@')[0],
      role,
      phoneNumber,
      isPhoneVerified: false,
      isActive: true,
      isEmailVerified: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    memoryStore.users.set(id, user);

    // Also create profile maps for organizer/mentor if needed (lightweight)
    // No separate profile tables for organizer-api minimal

    const tokens = createTokenPair(this.jwtConfig, { userId: id, role });
    // Store session
    memoryStore.sessions.set(tokens.sessionId, {
      id: tokens.sessionId,
      userId: id,
      refreshTokenHash: tokens.refreshJti, // we store jti, not hash for simplicity
      refreshJti: tokens.refreshJti,
      accessJti: tokens.accessJti,
      tokenVersion: 0,
      expiresAt: tokens.refreshTokenExpiresAt,
      revokedAt: null,
      createdAt: new Date().toISOString(),
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        displayName: user.displayName,
        role: user.role,
        phoneNumber: user.phoneNumber,
        isPhoneVerified: user.isPhoneVerified,
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: this.jwtConfig.accessTtlSec,
      // Phase 1: phone is required at registration — issue the first OTP inline.
      // Demo/testing only: raw OTP is SMS-sent in production.
      ...(process.env.NODE_ENV === 'production' ? {} : { phoneOtp: this.issuePhoneOtp(id, phoneNumber) }),
    };
  }

  async login(email: string, password: string) {
    const lower = email.toLowerCase();
    const user = Array.from(memoryStore.users.values()).find((u) => u.email === lower);
    if (!user) {
      throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
    }
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
    }
    if (!user.isActive) {
      throw Object.assign(new Error('User is deactivated'), { statusCode: 403 });
    }
    const tokens = createTokenPair(this.jwtConfig, { userId: user.id, role: user.role as Role });
    memoryStore.sessions.set(tokens.sessionId, {
      id: tokens.sessionId,
      userId: user.id,
      refreshTokenHash: tokens.refreshJti,
      refreshJti: tokens.refreshJti,
      accessJti: tokens.accessJti,
      tokenVersion: 0,
      expiresAt: tokens.refreshTokenExpiresAt,
      revokedAt: null,
      createdAt: new Date().toISOString(),
    });
    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        displayName: user.displayName,
        role: user.role,
        phoneNumber: user.phoneNumber ?? null,
        isPhoneVerified: user.isPhoneVerified ?? false,
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: this.jwtConfig.accessTtlSec,
    };
  }

  async refresh(rawRefreshToken: string) {
    if (!rawRefreshToken) throw Object.assign(new Error('Refresh token required'), { statusCode: 400 });
    let payload: any;
    try {
      payload = verifyRefreshToken(this.jwtConfig, rawRefreshToken);
    } catch (e: any) {
      throw Object.assign(new Error('Invalid refresh token: ' + e.message), { statusCode: 401 });
    }
    const session = memoryStore.sessions.get(payload.sessionId);
    if (!session) throw Object.assign(new Error('Session not found'), { statusCode: 401 });
    if (session.revokedAt) {
      throw Object.assign(new Error('Session revoked'), { statusCode: 401 });
    }
    if (new Date(session.expiresAt) < new Date()) {
      throw Object.assign(new Error('Refresh token expired'), { statusCode: 401 });
    }
    // Reuse detection: check jti matches
    if (payload.jti !== session.refreshJti) {
      // Potential reuse - revoke family
      session.revokedAt = new Date().toISOString();
      memoryStore.sessions.set(payload.sessionId, session);
      throw Object.assign(new Error('Token reuse detected. Session revoked.'), { statusCode: 401 });
    }

    // Rotate: revoke old, issue new pair same sessionId but new jtis
    const user = memoryStore.users.get(payload.sub);
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 401 });

    const newTokens = createTokenPair(this.jwtConfig, {
      userId: user.id,
      role: user.role as Role,
      sessionId: payload.sessionId,
      tokenVersion: (session.tokenVersion ?? 0) + 1,
    });

    // Update session with new jtis
    memoryStore.sessions.set(payload.sessionId, {
      ...session,
      refreshJti: newTokens.refreshJti,
      accessJti: newTokens.accessJti,
      tokenVersion: (session.tokenVersion ?? 0) + 1,
      lastUsedAt: new Date().toISOString(),
    });

    return {
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.refreshToken,
      expiresIn: this.jwtConfig.accessTtlSec,
    };
  }

  async getMe(userId: string) {
    const user = memoryStore.users.get(userId);
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      displayName: user.displayName,
      role: user.role,
      phoneNumber: user.phoneNumber ?? null,
      isPhoneVerified: user.isPhoneVerified ?? false,
      isEmailVerified: user.isEmailVerified,
      isActive: user.isActive,
    };
  }

  // ---------- Phone OTP Identity (Phase 1) ----------
  // ONE verified phone number = ONE HMT identity. OTPs are 6-digit codes,
  // SHA256-hashed at rest with a 5-minute TTL (same convention as participant-api).
  // Delivery is a stub: raw code returned by callers in non-prod only; a real
  // SmsSender provider plugs in here in a later phase without changing callers.
  private issuePhoneOtp(userId: string, phoneNumber: string): string {
    const { ttlSec } = otpConfig();
    // Single active code per phone: invalidate prior unused codes first.
    for (const [k, v] of memoryStore.phoneVerifications.entries()) {
      if (v.phoneNumber === phoneNumber && !v.isUsed) {
        memoryStore.phoneVerifications.set(k, { ...v, isUsed: true });
      }
    }
    const rawOtp = String(randomInt(100000, 1000000));
    const otpHash = this.hashOtp(rawOtp);
    memoryStore.phoneVerifications.set(otpHash, {
      id: randomUUID(),
      userId,
      phoneNumber,
      otpHash,
      expiresAt: Date.now() + ttlSec * 1000,
      attempts: 0,
      isUsed: false,
      createdAt: new Date().toISOString(),
    });
    return rawOtp;
  }

  async requestPhoneOtp(userId: string, rawPhoneNumber: string) {
    const { cooldownSec, ttlSec } = otpConfig();
    const user = memoryStore.users.get(userId);
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });
    if (user.isPhoneVerified) return { message: 'Phone already verified' };
    const phoneNumber = this.normalizePhoneNumber(rawPhoneNumber);
    if (user.phoneNumber && user.phoneNumber !== phoneNumber) {
      throw Object.assign(new Error('Phone number does not match your account'), { statusCode: 400 });
    }
    if (!user.phoneNumber) {
      // Backfill path for pre-Phase-1 accounts without a number: claim it here.
      const taken = Array.from(memoryStore.users.values()).find((u) => u.phoneNumber === phoneNumber);
      if (taken && taken.id !== userId) {
        throw Object.assign(new Error('Phone number is already registered'), { statusCode: 409 });
      }
      user.phoneNumber = phoneNumber;
      user.updatedAt = new Date().toISOString();
      memoryStore.users.set(userId, user);
    }
    // Resend cooldown (server-side, in-memory).
    const cooldownKey = this.hashOtp(phoneNumber);
    const limitedUntil = memoryStore.otpCooldowns.get(cooldownKey) ?? 0;
    if (Date.now() < limitedUntil) {
      throw Object.assign(new Error('OTP already sent. Please wait before requesting another code.'), {
        statusCode: 429,
      });
    }
    memoryStore.otpCooldowns.set(cooldownKey, Date.now() + cooldownSec * 1000);
    const rawOtp = this.issuePhoneOtp(userId, phoneNumber);
    if (process.env.NODE_ENV === 'production') {
      return { message: 'Verification code sent', expiresIn: `${ttlSec}s` };
    }
    return { message: 'Verification code sent', expiresIn: `${ttlSec}s`, phoneOtp: rawOtp };
  }

  async verifyPhone(userId: string, rawPhoneNumber: string, otp: string) {
    const { maxAttempts } = otpConfig();
    const user = memoryStore.users.get(userId);
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });
    if (user.isPhoneVerified) return { message: 'Phone already verified' };
    const phoneNumber = this.normalizePhoneNumber(rawPhoneNumber);
    if (user.phoneNumber && user.phoneNumber !== phoneNumber) {
      throw Object.assign(new Error('Phone number does not match your account'), { statusCode: 400 });
    }
    const targetPhone = user.phoneNumber ?? phoneNumber;

    const record = memoryStore.phoneVerifications.get(this.hashOtp(String(otp)));
    if (!record || record.userId !== userId || record.phoneNumber !== targetPhone) {
      // Wrong code: count against the latest pending code for lockout.
      let pending: any = null;
      for (const v of memoryStore.phoneVerifications.values()) {
        if (v.userId === userId && v.phoneNumber === targetPhone && !v.isUsed) {
          if (!pending || v.createdAt > pending.createdAt) pending = v;
        }
      }
      if (pending) {
        pending.attempts = (pending.attempts ?? 0) + 1;
        memoryStore.phoneVerifications.set(pending.otpHash, pending);
        if (pending.attempts >= maxAttempts) {
          throw Object.assign(new Error('Too many incorrect attempts. Please request a new code.'), {
            statusCode: 400,
          });
        }
      }
      throw Object.assign(new Error('Invalid verification code'), { statusCode: 400 });
    }
    if (record.isUsed) throw Object.assign(new Error('Code already used'), { statusCode: 400 });
    if (Date.now() > record.expiresAt) throw Object.assign(new Error('Code expired'), { statusCode: 400 });
    if ((record.attempts ?? 0) >= maxAttempts) {
      throw Object.assign(new Error('Too many incorrect attempts. Please request a new code.'), {
        statusCode: 400,
      });
    }
    record.isUsed = true;
    memoryStore.phoneVerifications.set(record.otpHash, record);
    // Claim the number on first verify (covers the backfill path) — unique index
    // on phoneNumber is enforced by the register/request dup-checks above.
    const clash = Array.from(memoryStore.users.values()).find(
      (u) => u.id !== userId && u.phoneNumber === targetPhone && u.isPhoneVerified,
    );
    if (clash) {
      throw Object.assign(new Error('Phone number is already verified by another account'), {
        statusCode: 409,
      });
    }
    user.phoneNumber = targetPhone;
    user.isPhoneVerified = true;
    user.updatedAt = new Date().toISOString();
    memoryStore.users.set(userId, user);
    memoryStore.otpCooldowns.delete(this.hashOtp(targetPhone));
    return { message: 'Phone verified successfully' };
  }

  async logout(userId: string, sessionId: string) {
    const session = memoryStore.sessions.get(sessionId);
    if (session && session.userId === userId) {
      session.revokedAt = new Date().toISOString();
      memoryStore.sessions.set(sessionId, session);
    }
    return { message: 'Logged out' };
  }

  async logoutAll(userId: string) {
    for (const [sid, sess] of memoryStore.sessions.entries()) {
      if (sess.userId === userId) {
        sess.revokedAt = new Date().toISOString();
        memoryStore.sessions.set(sid, sess);
      }
    }
    return { message: 'All sessions revoked' };
  }
}
