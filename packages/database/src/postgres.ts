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
  let timer: NodeJS.Timeout | undefined;
  try {
    // 2s deadline — callers (readiness probes) must never hang on a dead DB.
    const query = c.$queryRaw`SELECT 1`;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Postgres health check timed out after 2000ms')), 2000);
    });
    // Attach a no-op catch to the timeout so its late rejection (after the
    // race already settled) never surfaces as unhandledRejection.
    timeout.catch(() => {});
    await Promise.race([query, timeout]);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function disconnectPrisma(): Promise<void> {
  if (prismaClient) {
    await prismaClient.$disconnect();
    prismaClient = null;
  }
}

export { PrismaClient } from '@prisma/client';
