import { z } from 'zod';

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().finite().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().finite().min(1).max(100).default(20),
  sortBy: z.string().min(1).max(64).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function paginateMeta(total: number, page: number, pageSize: number) {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  const safePageSize = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : 20;
  return {
    page: safePage,
    pageSize: safePageSize,
    total: safeTotal,
    totalPages: Math.ceil(safeTotal / safePageSize),
  };
}
