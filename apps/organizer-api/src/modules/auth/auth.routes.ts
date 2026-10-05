import { FastifyInstance } from 'fastify';
import { AuthService } from './auth.service';
import { registerSchema, loginSchema, refreshSchema, requestPhoneOtpSchema, verifyPhoneSchema } from './auth.schemas';
import { createAuthGuard, getUser } from '../../shared/guards/auth.guard';
import type { JwtConfig } from '@hmt/security';

export async function authRoutes(app: FastifyInstance, opts: { jwtConfig: JwtConfig }) {
  const service = new AuthService(opts.jwtConfig);
  const authGuard = createAuthGuard(opts.jwtConfig);

  app.post('/auth/register', async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid payload', details: parsed.error.issues } });
    try {
      const res = await service.register(parsed.data as any);
      return reply.status(201).send(res);
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'REGISTER_FAILED', message: e.message } });
    }
  });

  app.post('/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid payload', details: parsed.error.issues } });
    try {
      const res = await service.login(parsed.data.email, parsed.data.password);
      return reply.send(res);
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'LOGIN_FAILED', message: e.message } });
    }
  });

  app.post('/auth/refresh', async (req, reply) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid payload', details: parsed.error.issues } });
    try {
      const res = await service.refresh(parsed.data.refreshToken);
      return reply.send(res);
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'REFRESH_FAILED', message: e.message } });
    }
  });

  app.get('/auth/me', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    const me = await service.getMe(user.id);
    return reply.send(me);
  });

  // Phase 1 phone identity (same contract as participant-api).
  app.post('/auth/phone/request-otp', { preHandler: [authGuard] }, async (req, reply) => {
    const parsed = requestPhoneOtpSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid payload', details: parsed.error.issues } });
    try {
      const user = getUser(req as any);
      const res = await service.requestPhoneOtp(user.id, parsed.data.phoneNumber);
      return reply.send(res);
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'PHONE_OTP_FAILED', message: e.message } });
    }
  });

  app.post('/auth/phone/verify', { preHandler: [authGuard] }, async (req, reply) => {
    const parsed = verifyPhoneSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid payload', details: parsed.error.issues } });
    try {
      const user = getUser(req as any);
      const res = await service.verifyPhone(user.id, parsed.data.phoneNumber, parsed.data.otp);
      return reply.send(res);
    } catch (e: any) {
      return reply.status(e.statusCode ?? 500).send({ error: { code: 'PHONE_VERIFY_FAILED', message: e.message } });
    }
  });

  app.post('/auth/logout', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    const body: any = req.body ?? {};
    // logout current session
    await service.logout(user.id, user.sessionId);
    return reply.send({ message: 'Logged out' });
  });

  app.post('/auth/logout-all', { preHandler: [authGuard] }, async (req, reply) => {
    const user = getUser(req as any);
    await service.logoutAll(user.id);
    return reply.send({ message: 'All sessions revoked' });
  });
}
