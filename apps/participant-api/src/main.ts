import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
// Workspace foundation compliance: uses shared @hmt/config and @hmt/observability via @hmt/database and @hmt/security (no duplicate auth)

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ---- Security headers (helmet-equivalent) ----
  const fastifyInstance: any = app.getHttpAdapter().getInstance();
  fastifyInstance.addHook('onSend', async (_req: any, reply: any) => {
    reply.header('x-dns-prefetch-control', 'off');
    reply.header('x-frame-options', 'SAMEORIGIN');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-xss-protection', '0');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cross-origin-opener-policy', 'same-origin');
    if (process.env.NODE_ENV === 'production') {
      reply.header('strict-transport-security', 'max-age=15552000; includeSubDomains');
    }
  });
  // ---- Request ID propagation ----
  fastifyInstance.addHook('onRequest', async (req: any, reply: any) => {
    const incoming = (req.headers['x-request-id'] as string) || (req.headers['x-correlation-id'] as string) || req.id;
    const requestId = incoming && incoming.length >= 8 ? incoming : randomUUID();
    (req as any).requestId = requestId;
    reply.header('x-request-id', requestId);
  });

  // CORS strict allowlist from env (fallback to localhost if not set)
  // Canonical dev ports: participant :3000, organizer :3002, frontend :5173.
  const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3002,http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (process.env.NODE_ENV === 'production') {
    const isDefault = corsOrigins.some((o) => o.includes('localhost'));
    if (isDefault) {
      logger.warn(
        'PRODUCTION WARNING: CORS_ORIGINS still contains localhost defaults. Set explicit production origins.',
      );
    }
  }
  app.enableCors({
    origin: (origin: any, cb: any) => {
      if (!origin) return cb(null, true);
      if (corsOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked: ${origin}`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Request-Id', 'X-Correlation-Id'],
    exposedHeaders: ['X-Request-Id'],
  });

  const config = new DocumentBuilder()
    .setTitle('HMT Participant Platform API')
    .setDescription(
      'Hackathon Management Tool Participant Backend Specification',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs/api', app, document);

  const port = process.env.PORT || 3000;
  // Dual-stack bind: `localhost` resolves to ::1 first on modern systems and
  // browsers attempt IPv6; an IPv4-only socket refuses them, surfacing as a
  // misleading CORS/NetworkError. '::' accepts both families (bindv6only=0).
  await app.listen(port, '::');
  logger.log(
    `HMT Participant Platform API running on http://localhost:${port}/api/v1`,
  );
  logger.log(
    `OpenAPI Documentation available at http://localhost:${port}/docs/api`,
  );
}

bootstrap();
