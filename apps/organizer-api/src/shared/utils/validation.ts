import { z } from 'zod';

export function parseOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const res = schema.safeParse(data);
  if (!res.success) {
    const e = new Error('Validation failed');
    (e as any).statusCode = 400;
    (e as any).issues = res.error.issues;
    throw e;
  }
  return res.data;
}
