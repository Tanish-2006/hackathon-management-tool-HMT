import { randomUUID } from 'crypto';
import { hashPassword, verifyPassword } from '@hmt/security';
import { createTokenPair, verifyRefreshToken } from '@hmt/security';
import type { JwtConfig } from '@hmt/security';
import { memoryStore } from '../../store/memory.store';
import type { Role } from '@hmt/common';

export interface RegisterData {
  email: string;
  password: string;
  fullName?: string;
  displayName?: string;
  role?: Role;
}

export class AuthService {
  constructor(private readonly jwtConfig: JwtConfig) {}

  async register(data: RegisterData) {
    const email = data.email.toLowerCase();
    const existing = Array.from(memoryStore.users.values()).find((u) => u.email === email);
    if (existing) {
      throw Object.assign(new Error('Email already registered'), { statusCode: 409 });
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
      user: { id: user.id, email: user.email, fullName: user.fullName, displayName: user.displayName, role: user.role },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: this.jwtConfig.accessTtlSec,
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
      user: { id: user.id, email: user.email, fullName: user.fullName, displayName: user.displayName, role: user.role },
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
    return { id: user.id, email: user.email, fullName: user.fullName, displayName: user.displayName, role: user.role, isEmailVerified: user.isEmailVerified, isActive: user.isActive };
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
