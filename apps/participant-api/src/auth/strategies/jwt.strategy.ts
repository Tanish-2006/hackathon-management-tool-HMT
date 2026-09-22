import { Injectable, UnauthorizedException, Optional } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../database/redis.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly redisService?: RedisService,
  ) {
    const accessSecret =
      configService.get<string>('JWT_ACCESS_SECRET') ||
      configService.get<string>('JWT_SECRET');
    // Fail fast in production if secret missing or too short (OWASP: >=32 chars)
    const isProd = configService.get<string>('NODE_ENV') === 'production';
    if (isProd && (!accessSecret || accessSecret.length < 32)) {
      throw new Error('JWT_ACCESS_SECRET must be >=32 chars in production');
    }
    const secret = accessSecret || 'fallback-dev-secret-change-in-prod-32-chars-minimum-for-tests-only-!!';
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      issuer: 'hmt',
      audience: 'hmt:api',
    });
  }

  async validate(payload: any) {
    if (!payload || !payload.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }
    // OWASP JWT validation: enforce issuer/audience and token type
    if (payload.iss && payload.iss !== 'hmt') {
      throw new UnauthorizedException('Invalid token issuer');
    }
    if (payload.aud && payload.aud !== 'hmt:api') {
      throw new UnauthorizedException('Invalid token audience');
    }
    // Prevent role escalation: if type field present, must be 'access'
    if (payload.type && payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type: expected access');
    }
    // Role must be one of allowed values
    const allowedRoles = ['PARTICIPANT', 'MENTOR', 'ORGANIZER', 'ADMIN'];
    if (payload.role && !allowedRoles.includes(payload.role)) {
      throw new UnauthorizedException('Invalid role in token');
    }
    // Access-token revocation (logout / session revoke / logout-all).
    // Best-effort Redis check; absence of Redis never grants extra authority.
    try {
      if (this.redisService && (payload.jti || payload.sessionId)) {
        if (payload.jti) {
          const revokedJti = await this.redisService.get(`hmt:auth:revoked:${payload.jti}`);
          if (revokedJti === '1') throw new UnauthorizedException('Session revoked');
          const family = await this.redisService.get(`hmt:auth:jti:${payload.jti}`);
          if (family) {
            const revokedFamily = await this.redisService.get(`hmt:auth:revoked:${family}`);
            if (revokedFamily === '1') throw new UnauthorizedException('Session revoked');
          }
        }
        if (payload.sessionId) {
          const revokedSession = await this.redisService.get(`hmt:auth:revoked:${payload.sessionId}`);
          if (revokedSession === '1') throw new UnauthorizedException('Session revoked');
        }
        const userRevokedAt = await this.redisService.get(`hmt:auth:revoked:user:${payload.sub}`);
        if (userRevokedAt && payload.iat) {
          const revokedMs = Number(userRevokedAt);
          if (Number.isFinite(revokedMs) && payload.iat * 1000 < revokedMs) {
            throw new UnauthorizedException('Session revoked');
          }
        }
      }
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      // Redis errors fail open for availability; refresh rotation + short TTL bound the window.
    }
    return { id: payload.sub, email: payload.email, role: payload.role, sessionId: payload.sessionId, jti: payload.jti };
  }
}
