import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../database/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '../database/redis.service';
import { ConfigService } from '@nestjs/config';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
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
      }),
    ).rejects.toThrow(ConflictException);
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
