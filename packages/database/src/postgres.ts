import { PrismaClient } from '@prisma/client';

let prismaClient: PrismaClient | null = null;

export function getPrismaClient(_databaseUrl?: string): PrismaClient {
  if (prismaClient) return prismaClient;
  // Prisma reads DATABASE_URL from env automatically; explicit datasources deprecated in v6+
  prismaClient = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? (['warn', 'error'] as const) : (['error'] as const),
  });
  return prismaClient;
}

export async function checkPostgresHealth(client?: PrismaClient): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const c = client ?? getPrismaClient();
  const start = Date.now();
  try {
    await c.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function disconnectPrisma(): Promise<void> {
  if (prismaClient) {
    await prismaClient.$disconnect();
    prismaClient = null;
  }
}

export { PrismaClient } from '@prisma/client';
