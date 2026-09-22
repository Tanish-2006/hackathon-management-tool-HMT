import { z } from 'zod';

export const emailSchema = z.string().email().max(254);
export const passwordSchema = z.string().min(8).max(128);
// Add more strict password rules via refinement if needed

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// Helper to create strict DTO validation pipe
export function strictSchema<T extends z.ZodObject<z.ZodRawShape>>(schema: T): T {
  return schema.strict() as T;
}
