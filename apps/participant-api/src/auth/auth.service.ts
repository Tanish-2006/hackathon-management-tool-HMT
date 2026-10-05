import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../database/redis.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import * as argon2 from 'argon2';
import { randomBytes, randomInt, createHash } from 'crypto';
import { Role } from '@prisma/client';

// Phase 1 phone OTP tuning (overridable via env: OTP_TTL_SEC, OTP_RESEND_COOLDOWN_SEC, OTP_MAX_ATTEMPTS).
const OTP_TTL_SEC_DEFAULT = 300;
const OTP_RESEND_COOLDOWN_SEC_DEFAULT = 60;
const OTP_MAX_ATTEMPTS_DEFAULT = 5;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Normalize to E.164: strip spaces/dashes/parens, require leading + country code.
   * DTOs validate the shape; this is defense-in-depth so service callers can never
   * store two spellings of the same number (which would break 1-phone-1-identity).
   */
  private normalizePhoneNumber(raw: string): string {
    const normalized = String(raw ?? '').replace(/[\s\-().]/g, '');
    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
      throw new BadRequestException('phoneNumber must be in E.164 format (e.g. +919876543210)');
    }
    return normalized;
  }

  private otpConfig() {
    const num = (key: string, fallback: number) =>
      Number(this.configService.get<string>(key)) || fallback;
    return {
      ttlSec: num('OTP_TTL_SEC', OTP_TTL_SEC_DEFAULT),
      cooldownSec: num('OTP_RESEND_COOLDOWN_SEC', OTP_RESEND_COOLDOWN_SEC_DEFAULT),
      maxAttempts: num('OTP_MAX_ATTEMPTS', OTP_MAX_ATTEMPTS_DEFAULT),
    };
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictException('Email address is already registered');
    }

    // ONE verified phone = ONE identity: reject a phone already claimed by any account.
    const phoneNumber = this.normalizePhoneNumber(dto.phoneNumber);
    const phoneTaken = await this.prisma.user.findUnique({
      where: { phoneNumber },
    } as any);
    if (phoneTaken) {
      throw new ConflictException('Phone number is already registered');
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    let user: any;
    try {
      user = await this.prisma.user.create({
        data: {
          email: dto.email.toLowerCase(),
          passwordHash,
          fullName: dto.fullName,
          phoneNumber,
          role: Role.PARTICIPANT,
          profile: {
            create: {
              bio: '',
              skills: [],
            },
          },
        },
        include: { profile: true },
      });
    } catch (e: any) {
      // Race guard: unique constraint (email or phone) lost between check and create.
      if (e?.code === 'P2002') {
        throw new ConflictException('Email or phone number is already registered');
      }
      throw e;
    }

    // create email verification token architecture (do not auto-verify)
    const rawVerifyToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawVerifyToken);
    await this.prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    } as any);
    this.logger.log(
      `Email verification token generated for ${user.email}: ${rawVerifyToken} (hashed stored)`,
    );

    const tokens = await this.generateTokenPair(user.id, user.email, user.role);

    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'REGISTER',
        resource: `user:${user.id}`,
        details: { email: user.email },
      },
    } as any);

    // Phase 1: phone is required at registration — issue the first OTP inline.
    const phoneOtp = await this.issuePhoneOtp(user.id, phoneNumber);

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        phoneNumber: user.phoneNumber,
        isPhoneVerified: user.isPhoneVerified ?? false,
      },
      // Demo/testing only: raw verification token is emailed in production.
      ...(this.configService.get<string>('NODE_ENV') === 'production'
        ? {}
        : { verificationToken: rawVerifyToken }),
      // Demo/testing only: raw OTP is SMS-sent in production (SmsSender stub).
      ...(this.configService.get<string>('NODE_ENV') === 'production'
        ? {}
        : { phoneOtp }),
      ...tokens,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await argon2.verify(
      user.passwordHash,
      dto.password,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokenPair(user.id, user.email, user.role);
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'LOGIN',
        resource: `user:${user.id}`,
        details: {},
      },
    } as any);

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        phoneNumber: user.phoneNumber ?? null,
        isPhoneVerified: user.isPhoneVerified ?? false,
      },
      ...tokens,
    };
  }

  async refreshToken(rawRefreshToken: string) {
    if (!rawRefreshToken) {
      throw new BadRequestException('Refresh token is required');
    }

    const tokenHash = this.hashToken(rawRefreshToken);

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (storedToken.isRevoked) {
      this.logger.warn(
        `Refresh token reuse detected for family ${storedToken.familyId}! Revoking all sessions.`,
      );
      await this.prisma.refreshToken.updateMany({
        where: { familyId: storedToken.familyId },
        data: { isRevoked: true },
      });
      await this.prisma.auditLog.create({
        data: {
          userId: storedToken.userId,
          action: 'TOKEN_REUSE_DETECTED',
          resource: `family:${storedToken.familyId}`,
          details: {},
        },
      } as any);
      throw new UnauthorizedException(
        'Token reuse detected. All sessions revoked.',
      );
    }

    if (new Date() > storedToken.expiresAt) {
      throw new UnauthorizedException('Refresh token expired');
    }

    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { isRevoked: true },
    });

    return this.generateTokenPair(
      storedToken.user.id,
      storedToken.user.email,
      storedToken.user.role,
      storedToken.familyId,
    );
  }

  async logout(userId: string, rawRefreshToken?: string) {
    if (rawRefreshToken) {
      const tokenHash = this.hashToken(rawRefreshToken);
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash },
        data: { isRevoked: true },
      });
      try {
        const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } } as any);
        if (stored?.familyId) {
          // Revoke family so any access token mapped to it is denied at validation.
          await this.redisService.set(`hmt:auth:revoked:${stored.familyId}`, '1', 604800);
        }
      } catch {}
    }
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'LOGOUT',
        resource: `user:${userId}`,
        details: {},
      },
    } as any);
    return { message: 'Logged out successfully' };
  }

  async logoutAll(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId },
      data: { isRevoked: true },
    });
    await this.prisma.deviceSession.updateMany({
      where: { userId },
      data: { isRevoked: true },
    } as any);
    try {
      // User-level revocation marker; JwtStrategy denies access tokens issued before it.
      await this.redisService.set(`hmt:auth:revoked:user:${userId}`, String(Date.now()), 604800);
    } catch {}
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'LOGOUT_ALL',
        resource: `user:${userId}`,
        details: {},
      },
    } as any);
    return { message: 'All sessions logged out successfully' };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isEmailVerified: true,
        phoneNumber: true,
        isPhoneVerified: true,
        profile: true,
        teamMemberships: {
          include: {
            team: {
              include: {
                hackathon: true,
                project: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }

  // ---------- Email Verification Architecture ----------
  async requestEmailVerification(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.isEmailVerified) return { message: 'Email already verified' };
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    await this.prisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    } as any);
    return {
      message: 'Verification email sent',
      verificationToken: rawToken,
      expiresIn: '24h',
    };
  }

  async verifyEmail(token: string) {
    const tokenHash = this.hashToken(token);
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    } as any);
    if (!record) throw new BadRequestException('Invalid verification token');
    if (record.isUsed) throw new BadRequestException('Token already used');
    if (new Date() > record.expiresAt)
      throw new BadRequestException('Token expired');
    await this.prisma.emailVerificationToken.update({
      where: { tokenHash },
      data: { isUsed: true },
    } as any);
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { isEmailVerified: true },
    } as any);
    await this.prisma.auditLog.create({
      data: {
        userId: record.userId,
        action: 'EMAIL_VERIFIED',
        resource: `user:${record.userId}`,
        details: {},
      },
    } as any);
    return { message: 'Email verified successfully' };
  }

  // ---------- Phone OTP Identity (Phase 1) ----------
  // ONE verified phone number = ONE participant identity. OTPs are 6-digit codes,
  // SHA256-hashed at rest with a 5-minute TTL (same convention as email tokens).
  // Delivery is a stub: Logger.log + raw OTP in non-prod responses; a real
  // SmsSender provider plugs in here in a later phase without changing callers.
  private async issuePhoneOtp(userId: string, phoneNumber: string) {
    const { ttlSec } = this.otpConfig();
    // Single active code per phone: invalidate prior unused codes first.
    await (this.prisma as any).phoneVerification.updateMany({
      where: { phoneNumber, isUsed: false },
      data: { isUsed: true },
    });
    const rawOtp = String(randomInt(100000, 1000000));
    const otpHash = this.hashToken(rawOtp);
    await (this.prisma as any).phoneVerification.create({
      data: {
        userId,
        phoneNumber,
        otpHash,
        expiresAt: new Date(Date.now() + ttlSec * 1000),
      },
    });
    // Stub SMS delivery: logged server-side; raw code returned by callers in non-prod only.
    this.logger.log(`Phone OTP generated for ${phoneNumber} (hashed stored)`);
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'PHONE_OTP_REQUESTED',
        resource: `user:${userId}`,
        details: {},
      },
    } as any);
    return rawOtp;
  }

  async requestPhoneOtp(userId: string, rawPhoneNumber: string) {
    const { cooldownSec, ttlSec } = this.otpConfig();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.isPhoneVerified) return { message: 'Phone already verified' };
    const phoneNumber = this.normalizePhoneNumber(rawPhoneNumber);
    if (user.phoneNumber && user.phoneNumber !== phoneNumber) {
      throw new BadRequestException('Phone number does not match your account');
    }
    if (!user.phoneNumber) {
      // Backfill path for pre-Phase-1 accounts without a number: claim it here.
      const taken = await this.prisma.user.findUnique({ where: { phoneNumber } } as any);
      if (taken && taken.id !== userId) {
        throw new ConflictException('Phone number is already registered');
      }
      try {
        await this.prisma.user.update({ where: { id: userId }, data: { phoneNumber } } as any);
      } catch (e: any) {
        if (e?.code === 'P2002') {
          throw new ConflictException('Phone number is already registered');
        }
        throw e;
      }
    }
    // Resend cooldown (Redis with in-memory fallback; best-effort).
    const cooldownKey = `hmt:auth:otp:${this.hashToken(phoneNumber)}`;
    try {
      const limited = await this.redisService.get(cooldownKey);
      if (limited) {
        throw new HttpException(
          'OTP already sent. Please wait before requesting another code.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      await this.redisService.set(cooldownKey, '1', cooldownSec);
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
      // Redis unavailable — continue without cooldown (fail-open, logged by RedisService).
    }
    const rawOtp = await this.issuePhoneOtp(userId, phoneNumber);
    if (this.configService.get<string>('NODE_ENV') === 'production') {
      return { message: 'Verification code sent', expiresIn: `${ttlSec}s` };
    }
    return { message: 'Verification code sent', expiresIn: `${ttlSec}s`, phoneOtp: rawOtp };
  }

  async verifyPhone(userId: string, rawPhoneNumber: string, otp: string) {
    const { maxAttempts } = this.otpConfig();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.isPhoneVerified) return { message: 'Phone already verified' };
    const phoneNumber = this.normalizePhoneNumber(rawPhoneNumber);
    if (user.phoneNumber && user.phoneNumber !== phoneNumber) {
      throw new BadRequestException('Phone number does not match your account');
    }
    const targetPhone = user.phoneNumber ?? phoneNumber;

    const record = await (this.prisma as any).phoneVerification.findUnique({
      where: { otpHash: this.hashToken(String(otp)) },
    });
    if (!record || record.userId !== userId || record.phoneNumber !== targetPhone) {
      // Wrong code: count against the latest pending code for lockout.
      const pending = await (this.prisma as any).phoneVerification.findFirst({
        where: { userId, phoneNumber: targetPhone, isUsed: false },
        orderBy: { createdAt: 'desc' },
      });
      if (pending) {
        const attempts = (pending.attempts ?? 0) + 1;
        await (this.prisma as any).phoneVerification.update({
          where: { id: pending.id },
          data: { attempts },
        });
        if (attempts >= maxAttempts) {
          throw new BadRequestException('Too many incorrect attempts. Please request a new code.');
        }
      }
      throw new BadRequestException('Invalid verification code');
    }
    if (record.isUsed) throw new BadRequestException('Code already used');
    if (new Date() > record.expiresAt) throw new BadRequestException('Code expired');
    if ((record.attempts ?? 0) >= maxAttempts) {
      throw new BadRequestException('Too many incorrect attempts. Please request a new code.');
    }
    await (this.prisma as any).phoneVerification.update({
      where: { id: record.id },
      data: { isUsed: true },
    });
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { isPhoneVerified: true, phoneNumber: targetPhone } as any,
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException('Phone number is already verified by another account');
      }
      throw e;
    }
    try {
      await this.redisService.del(`hmt:auth:otp:${this.hashToken(targetPhone)}`);
    } catch {}
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'PHONE_VERIFIED',
        resource: `user:${userId}`,
        details: {},
      },
    } as any);
    return { message: 'Phone verified successfully' };
  }

  // ---------- Password Reset ----------
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    // Always return generic message to avoid enumeration
    if (!user)
      return { message: 'If account exists, password reset email sent' };
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    } as any);
    this.logger.log(`Password reset token for ${email}: ${rawToken}`);
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'PASSWORD_RESET_REQUESTED',
        resource: `user:${user.id}`,
        details: {},
      },
    } as any);
    // Demo/testing only: raw reset token is emailed in production.
    if (this.configService.get<string>('NODE_ENV') === 'production') {
      return {
        message: 'If account exists, password reset email sent',
      };
    }
    return {
      message: 'If account exists, password reset email sent',
      resetToken: rawToken,
    };
  }

  async resetPassword(token: string, newPassword: string) {
    const tokenHash = this.hashToken(token);
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    } as any);
    if (!record) throw new BadRequestException('Invalid reset token');
    if (record.isUsed) throw new BadRequestException('Token already used');
    if (new Date() > record.expiresAt)
      throw new BadRequestException('Token expired');
    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    } as any);
    await this.prisma.passwordResetToken.update({
      where: { tokenHash },
      data: { isUsed: true },
    } as any);
    // revoke all sessions on password change
    await this.prisma.refreshToken.updateMany({
      where: { userId: record.userId },
      data: { isRevoked: true },
    } as any);
    await this.prisma.auditLog.create({
      data: {
        userId: record.userId,
        action: 'PASSWORD_RESET',
        resource: `user:${record.userId}`,
        details: {},
      },
    } as any);
    return { message: 'Password reset successful' };
  }

  // ---------- Session / Device Management ----------
  async getSessions(userId: string) {
    const sessions = await this.prisma.deviceSession.findMany({
      where: { userId },
    } as any);
    const tokens = await this.prisma.refreshToken.findMany({
      where: { userId },
    } as any);
    // merge by familyId
    const byFamily = new Map<string, any>();
    for (const t of tokens) {
      if (!byFamily.has(t.familyId))
        byFamily.set(t.familyId, {
          familyId: t.familyId,
          tokens: [],
          createdAt: t.createdAt,
          isRevoked: t.isRevoked,
        });
      byFamily.get(t.familyId).tokens.push(t);
    }
    // also include device sessions
    return { sessions, tokenFamilies: Array.from(byFamily.values()) };
  }

  async revokeSession(userId: string, familyId: string) {
    const tokenFamily = await this.prisma.refreshToken.findMany({
      where: { userId, familyId },
    } as any);
    if (!tokenFamily || tokenFamily.length === 0)
      throw new NotFoundException(
        'Session not found or not owned (IDOR prevented)',
      );
    // ownership check: ensure family belongs to user
    const owned = tokenFamily.every((t: any) => t.userId === userId);
    if (!owned)
      throw new UnauthorizedException('Not authorized to manage this session');
    await this.prisma.refreshToken.updateMany({
      where: { familyId },
      data: { isRevoked: true },
    } as any);
    await this.prisma.deviceSession.updateMany({
      where: { familyId },
      data: { isRevoked: true },
    } as any);
    try {
      await this.redisService.set(`hmt:auth:revoked:${familyId}`, '1', 604800);
    } catch {}
    return { message: 'Session revoked' };
  }

  private async generateTokenPair(
    userId: string,
    email: string,
    role: Role,
    existingFamilyId?: string,
  ) {
    // OWASP JWT: include issuer/audience via options, type, jti, sessionId; short-lived 15m
    const sessionId = randomBytes(16).toString('hex');
    const jti = randomBytes(16).toString('hex');
    const payload = { sub: userId, email, role, sessionId, jti, type: 'access' } as any;
    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m', issuer: 'hmt', audience: 'hmt:api' } as any);

    const rawRefreshToken = randomBytes(40).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);
    const familyId = existingFamilyId || randomBytes(16).toString('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        familyId,
        expiresAt,
      },
    });
    // Also store jti in Redis with TTL for reuse detection + logout invalidation (Redis ephemeral)
    try {
      await this.redisService.set(`hmt:auth:jti:${jti}`, familyId, 900);
      await this.redisService.set(`hmt:auth:family:${familyId}:jti:${jti}`, '1', 900);
    } catch {}

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: 900,
      sessionId,
      jti,
    };
  }
}
