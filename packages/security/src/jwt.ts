import jwt, { JwtPayload } from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import type { Role } from './rbac';

export interface AccessTokenPayload extends JwtPayload {
  sub: string; // userId
  role: Role;
  sessionId: string;
  jti: string;
  type: 'access';
}

export interface RefreshTokenPayload extends JwtPayload {
  sub: string;
  sessionId: string;
  jti: string;
  type: 'refresh';
  tokenVersion: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  sessionId: string;
  accessJti: string;
  refreshJti: string;
}

export interface JwtConfig {
  accessSecret: string;
  refreshSecret: string;
  accessTtlSec: number;
  refreshTtlSec: number;
  issuer?: string;
  audience?: string;
}

export function signAccessToken(
  config: JwtConfig,
  params: { userId: string; role: Role; sessionId: string },
): { token: string; jti: string; expiresAt: Date } {
  const jti = randomUUID();
  const payload: Omit<AccessTokenPayload, 'iat' | 'exp'> = {
    sub: params.userId,
    role: params.role,
    sessionId: params.sessionId,
    jti,
    type: 'access',
  };
  const token = jwt.sign(payload, config.accessSecret, {
    expiresIn: config.accessTtlSec,
    issuer: config.issuer ?? 'hmt',
    audience: config.audience ?? 'hmt:api',
  });
  return { token, jti, expiresAt: new Date(Date.now() + config.accessTtlSec * 1000) };
}

export function signRefreshToken(
  config: JwtConfig,
  params: { userId: string; sessionId: string; tokenVersion: number },
): { token: string; jti: string; expiresAt: Date } {
  const jti = randomUUID();
  const payload: Omit<RefreshTokenPayload, 'iat' | 'exp'> = {
    sub: params.userId,
    sessionId: params.sessionId,
    jti,
    type: 'refresh',
    tokenVersion: params.tokenVersion,
  };
  const token = jwt.sign(payload, config.refreshSecret, {
    expiresIn: config.refreshTtlSec,
    issuer: config.issuer ?? 'hmt',
    audience: config.audience ?? 'hmt:api',
  });
  return { token, jti, expiresAt: new Date(Date.now() + config.refreshTtlSec * 1000) };
}

export function verifyAccessToken(config: JwtConfig, token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, config.accessSecret, {
    issuer: config.issuer ?? 'hmt',
    audience: config.audience ?? 'hmt:api',
  }) as AccessTokenPayload;
  if (decoded.type !== 'access') throw new Error('Invalid token type: expected access');
  return decoded;
}

export function verifyRefreshToken(config: JwtConfig, token: string): RefreshTokenPayload {
  const decoded = jwt.verify(token, config.refreshSecret, {
    issuer: config.issuer ?? 'hmt',
    audience: config.audience ?? 'hmt:api',
  }) as RefreshTokenPayload;
  if (decoded.type !== 'refresh') throw new Error('Invalid token type: expected refresh');
  return decoded;
}

export function createTokenPair(
  config: JwtConfig,
  params: { userId: string; role: Role; sessionId?: string; tokenVersion?: number },
): TokenPair {
  const sessionId = params.sessionId ?? randomUUID();
  const tokenVersion = params.tokenVersion ?? 0;
  const access = signAccessToken(config, {
    userId: params.userId,
    role: params.role,
    sessionId,
  });
  const refresh = signRefreshToken(config, {
    userId: params.userId,
    sessionId,
    tokenVersion,
  });
  return {
    accessToken: access.token,
    refreshToken: refresh.token,
    accessTokenExpiresAt: access.expiresAt,
    refreshTokenExpiresAt: refresh.expiresAt,
    sessionId,
    accessJti: access.jti,
    refreshJti: refresh.jti,
  };
}

/**
 * Refresh token rotation & reuse detection:
 * - Each refresh use MUST rotate (issue new pair, invalidate old jti)
 * - Store used jtis in Redis with TTL = refreshTtlSec to detect reuse
 * - On reuse -> revoke entire session family (all tokens for sessionId)
 * See docs/SECURITY.md for full flow.
 */
