import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { FastifyRequest } from 'fastify';
import type { Logger } from 'pino';
import { getRequestId } from '@hmt/observability';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: Logger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const start = Date.now();
    const requestId = getRequestId() ?? (req.headers['x-request-id'] as string) ?? 'unknown';

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - start;
          this.logger.info({ requestId, method: req.method, url: req.url, durationMs: ms }, 'request completed');
        },
        error: (err: unknown) => {
          const ms = Date.now() - start;
          this.logger.error({ requestId, method: req.method, url: req.url, durationMs: ms, err }, 'request failed');
        },
      }),
    );
  }
}
