import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../database/redis.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import * as argon2 from 'argon2';
import { randomBytes, createHash } from 'crypto';
import { Role } from '@prisma/client';

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

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictException('Email address is already registered');
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
        fullName: dto.fullName,
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

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
      },
      // Demo/testing only: raw verification token is emailed in production.
      ...(this.configService.get<string>('NODE_ENV') === 'production'
        ? {}
        : { verificationToken: rawVerifyToken }),
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
