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

const VALID_ROLES = new Set(['PARTICIPANT', 'ORGANIZER', 'MENTOR', 'ADMIN']);

function assertJwtConfig(config: JwtConfig): void {
  for (const key of ['accessSecret', 'refreshSecret'] as const) {
    const v = config[key];
    if (typeof v !== 'string' || v.length < 32 || v.trim().length < 32) {
      throw new Error(`Invalid JWT config: ${key} must be a string of at least 32 characters`);
    }
  }
  for (const key of ['accessTtlSec', 'refreshTtlSec'] as const) {
    const v = config[key];
    if (!Number.isFinite(v) || !Number.isInteger(v) || v <= 0) {
      throw new Error(`Invalid JWT config: ${key} must be a positive integer (seconds)`);
    }
  }
  if (config.accessSecret === config.refreshSecret) {
    // Same secret for both is a misconfig: `type` remains the only barrier
    // between access/refresh cross-use. Warn loudly but do not throw so a
    // misconfigured deploy degrades (auditable) instead of total auth outage.
    // eslint-disable-next-line no-console
    console.warn('[security] JWT accessSecret and refreshSecret are identical — set distinct 32+ char secrets');
  }
}

function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid token payload: ${name} must be a non-empty string`);
  }
}

export function signAccessToken(
  config: JwtConfig,
  params: { userId: string; role: Role; sessionId: string },
): { token: string; jti: string; expiresAt: Date } {
  assertJwtConfig(config);
  assertNonEmptyString(params.userId, 'userId');
  assertNonEmptyString(params.sessionId, 'sessionId');
  if (!VALID_ROLES.has(params.role)) throw new Error('Invalid token payload: role must be a known Role');
  const jti = randomUUID();
  const payload: Omit<AccessTokenPayload, 'iat' | 'exp'> = {
    sub: params.userId,
    role: params.role,
    sessionId: params.sessionId,
    jti,
    type: 'access',
  };
  const token = jwt.sign(payload, config.accessSecret, {
    algorithm: 'HS256',
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
  assertJwtConfig(config);
  assertNonEmptyString(params.userId, 'userId');
  assertNonEmptyString(params.sessionId, 'sessionId');
  if (!Number.isInteger(params.tokenVersion) || params.tokenVersion < 0) {
    throw new Error('Invalid token payload: tokenVersion must be an integer >= 0');
  }
  const jti = randomUUID();
  const payload: Omit<RefreshTokenPayload, 'iat' | 'exp'> = {
    sub: params.userId,
    sessionId: params.sessionId,
    jti,
    type: 'refresh',
    tokenVersion: params.tokenVersion,
  };
  const token = jwt.sign(payload, config.refreshSecret, {
    algorithm: 'HS256',
    expiresIn: config.refreshTtlSec,
    issuer: config.issuer ?? 'hmt',
    audience: config.audience ?? 'hmt:api',
  });
  return { token, jti, expiresAt: new Date(Date.now() + config.refreshTtlSec * 1000) };
}

export function verifyAccessToken(config: JwtConfig, token: string): AccessTokenPayload {
  assertJwtConfig(config);
  if (typeof token !== 'string' || token.length === 0) throw new Error('Invalid token: empty');
  const decoded = jwt.verify(token, config.accessSecret, {
    algorithms: ['HS256'],
    issuer: config.issuer ?? 'hmt',
    audience: config.audience ?? 'hmt:api',
  }) as AccessTokenPayload;
  if (decoded.type !== 'access') throw new Error('Invalid token type: expected access');
  assertNonEmptyString(decoded.sub, 'sub');
  assertNonEmptyString(decoded.sessionId, 'sessionId');
  assertNonEmptyString(decoded.jti, 'jti');
  if (!VALID_ROLES.has(decoded.role)) throw new Error('Invalid token payload: unknown role');
  return decoded;
}

export function verifyRefreshToken(config: JwtConfig, token: string): RefreshTokenPayload {
  assertJwtConfig(config);
  if (typeof token !== 'string' || token.length === 0) throw new Error('Invalid token: empty');
  const decoded = jwt.verify(token, config.refreshSecret, {
    algorithms: ['HS256'],
    issuer: config.issuer ?? 'hmt',
    audience: config.audience ?? 'hmt:api',
  }) as RefreshTokenPayload;
  if (decoded.type !== 'refresh') throw new Error('Invalid token type: expected refresh');
  assertNonEmptyString(decoded.sub, 'sub');
  assertNonEmptyString(decoded.sessionId, 'sessionId');
  assertNonEmptyString(decoded.jti, 'jti');
  if (!Number.isInteger(decoded.tokenVersion) || (decoded.tokenVersion as number) < 0) {
    throw new Error('Invalid token payload: tokenVersion must be an integer >= 0');
  }
  return decoded;
}

export function createTokenPair(
  config: JwtConfig,
  params: { userId: string; role: Role; sessionId?: string; tokenVersion?: number },
): TokenPair {
  assertJwtConfig(config);
  assertNonEmptyString(params.userId, 'userId');
  if (!VALID_ROLES.has(params.role)) throw new Error('Invalid token payload: role must be a known Role');
  const sessionId = params.sessionId && params.sessionId.length > 0 ? params.sessionId : randomUUID();
  const tokenVersion = params.tokenVersion ?? 0;
  if (!Number.isInteger(tokenVersion) || tokenVersion < 0) {
    throw new Error('Invalid token payload: tokenVersion must be an integer >= 0');
  }
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
