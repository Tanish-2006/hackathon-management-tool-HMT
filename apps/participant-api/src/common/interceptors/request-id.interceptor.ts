import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { randomUUID } from 'node:crypto';
import { FastifyRequest, FastifyReply } from 'fastify';
import { requestContextStorage } from '@hmt/observability';

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<FastifyRequest & { id: string }>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();

    const incoming = (req.headers['x-request-id'] as string) || req.headers['x-correlation-id'] as string;
    const requestId = incoming && typeof incoming === 'string' && incoming.length >= 8 ? incoming : randomUUID();

    // Attach to request & response headers
    (req as unknown as Record<string, unknown>).requestId = requestId;
    reply.header('x-request-id', requestId);

    // Run within ALS context so logger can pick it up
    return new Observable((subscriber) => {
      requestContextStorage.run({ requestId }, () => {
        next.handle().subscribe({
          next: (v) => subscriber.next(v),
          error: (e) => subscriber.error(e),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
