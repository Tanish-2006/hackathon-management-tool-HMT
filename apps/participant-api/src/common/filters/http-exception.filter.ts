import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import type { Logger as PinoLogger } from 'pino';
import { getRequestId } from '@hmt/observability';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly pino?: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest & { id?: string }>();

    const requestId = (request.headers['x-request-id'] as string) || getRequestId() || request.id || 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code = 'INTERNAL_ERROR';
    let details: unknown = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'string') {
        message = resp;
      } else if (typeof resp === 'object' && resp !== null) {
        const r = resp as Record<string, unknown>;
        message = (r.message as string) ?? exception.message;
        code = (r.error as string) ?? code;
        details = r.details ?? r.message;
      }
      code = this.mapStatusToCode(status, code);
    } else if (exception instanceof Error) {
      message = status === 500 ? 'Internal server error' : exception.message;
      // Never leak stack in production; log it instead
      this.pino?.error({ err: exception, requestId, url: request.url }, 'unhandled exception');
      Logger.error(exception.stack, exception.message, 'HttpExceptionFilter');
    }

    // Safe error handling: redact secrets already via logger; response never includes stack
    const body = {
      version: 'v1' as const,
      error: {
        code,
        message: status === 500 && process.env.NODE_ENV === 'production' ? 'Internal server error' : message,
        ...(details && status !== 500 ? { details } : {}),
        requestId,
      },
    };

    reply.status(status).header('x-request-id', requestId).send(body);
  }

  private mapStatusToCode(status: number, fallback: string): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'RATE_LIMITED',
    };
    return map[status] ?? fallback;
  }
}
