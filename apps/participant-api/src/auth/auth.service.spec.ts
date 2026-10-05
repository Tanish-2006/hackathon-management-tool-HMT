import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../database/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '../database/redis.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';

describe('AuthService Security & Token Family Suite', () => {
  let authService: AuthService;
  let prismaService: any;
  let jwtService: any;

  beforeEach(async () => {
    prismaService = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
      },
      emailVerificationToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      passwordResetToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      phoneVerification: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      deviceSession: { updateMany: jest.fn(), findMany: jest.fn(), create: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
    };

    jwtService = {
      sign: jest.fn().mockReturnValue('mock-access-jwt-token'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaService },
        { provide: JwtService, useValue: jwtService },
        {
          provide: RedisService,
          useValue: { set: jest.fn(), get: jest.fn(), del: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test-secret') },
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  it('should prevent registration with duplicate email (ConflictException)', async () => {
    prismaService.user.findUnique.mockResolvedValue({ id: 'existing-user-id', email: 'test@example.com' });

    await expect(
      authService.register({
        email: 'test@example.com',
        password: 'Password123!',
        fullName: 'Test Participant',
        phoneNumber: '+919876543210',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('should prevent registration with duplicate phone number (one phone = one identity)', async () => {
    prismaService.user.findUnique.mockImplementation(({ where }: any) => {
      if (where.email) return Promise.resolve(null);
      if (where.phoneNumber) return Promise.resolve({ id: 'other-user', phoneNumber: where.phoneNumber });
      return Promise.resolve(null);
    });

    await expect(
      authService.register({
        email: 'new@example.com',
        password: 'Password123!',
        fullName: 'Test Participant',
        phoneNumber: '+919876543210',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('should verify phone with a valid OTP and mark the user verified', async () => {
    const userId = 'user-1';
    prismaService.user.findUnique.mockResolvedValue({
      id: userId,
      phoneNumber: '+919876543210',
      isPhoneVerified: false,
    });
    prismaService.phoneVerification.findUnique.mockResolvedValue({
      id: 'pv-1',
      userId,
      phoneNumber: '+919876543210',
      otpHash: 'hash',
      expiresAt: new Date(Date.now() + 100000),
      attempts: 0,
      isUsed: false,
    });
    prismaService.phoneVerification.update.mockResolvedValue({});
    prismaService.user.update.mockResolvedValue({});

    await expect(
      authService.verifyPhone(userId, '+919876543210', '482913'),
    ).resolves.toEqual({ message: 'Phone verified successfully' });
    expect(prismaService.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: { isPhoneVerified: true, phoneNumber: '+919876543210' },
    });
  });

  it('should reject phone verification with an invalid code', async () => {
    const userId = 'user-1';
    prismaService.user.findUnique.mockResolvedValue({
      id: userId,
      phoneNumber: '+919876543210',
      isPhoneVerified: false,
    });
    prismaService.phoneVerification.findUnique.mockResolvedValue(null);
    prismaService.phoneVerification.findFirst.mockResolvedValue(null);

    await expect(
      authService.verifyPhone(userId, '+919876543210', '000000'),
    ).rejects.toThrow(BadRequestException);
  });

  it('should detect refresh token reuse and revoke token family', async () => {
    prismaService.refreshToken.findUnique.mockResolvedValue({
      id: 'token-1',
      familyId: 'family-abc',
      isRevoked: true, // ALREADY REVOKED (REUSE SIMULATION)
      expiresAt: new Date(Date.now() + 100000),
      user: { id: 'user-1', email: 'user@example.com', role: Role.PARTICIPANT },
    });

    await expect(authService.refreshToken('stolen-used-refresh-token')).rejects.toThrow(UnauthorizedException);

    expect(prismaService.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: 'family-abc' },
      data: { isRevoked: true },
    });
  });
});
