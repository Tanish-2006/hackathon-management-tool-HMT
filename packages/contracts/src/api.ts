import { z } from 'zod';

/**
 * Versioned API contracts (DTO shapes) - shared between participant-api and organizer-api.
 * Both APIs expose /api/v1/... with consistent envelope.
 */

export const apiVersion = 'v1' as const;

export const apiEnvelopeSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    version: z.literal(apiVersion),
    data: dataSchema,
    meta: z
      .object({
        requestId: z.string().min(1).max(128),
        timestamp: z.string().datetime(),
        pagination: z
          .object({
            page: z.number().int().min(1).max(10000),
            pageSize: z.number().int().min(1).max(100),
            total: z.number().int().min(0),
            totalPages: z.number().int().min(0),
          })
          .refine(
            (p) => p.totalPages === Math.ceil(p.total / p.pageSize),
            { message: 'totalPages must equal ceil(total / pageSize)' },
          )
          .optional(),
      })
      .optional(),
  });

export const errorEnvelopeSchema = z.object({
  version: z.literal(apiVersion),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});

// --- Example shared DTOs (foundation only, no business logic) ---

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  service: z.string().min(1),
  version: z.string().min(1),
  uptimeSeconds: z.number().min(0),
  checks: z.object({
    api: z.enum(['ok', 'degraded', 'down']),
    postgres: z.enum(['ok', 'down', 'unknown', 'degraded']),
    neo4j: z.enum(['ok', 'down', 'unknown', 'degraded']),
    redis: z.enum(['ok', 'down', 'unknown', 'degraded']),
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
