import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SyncService } from './sync.service';
import { SyncAuthGuard } from './sync-auth.guard';

function publishedEvent(id: string, eventId: string) {
  return {
    eventId,
    version: 'v1',
    type: 'HackathonPublished',
    occurredAt: new Date().toISOString(),
    actorId: null,
    payload: {
      hackathonId: id,
      slug: `hack-${id.slice(0, 8)}`,
      title: `Hack ${id.slice(0, 8)}`,
      publishedAt: new Date().toISOString(),
      phases: [{ phaseId: 'ph-1', name: 'registration', startsAt: '2026-11-01T09:00:00.000Z', endsAt: '2026-11-02T09:00:00.000Z' }],
    },
  };
}

function archivedEvent(id: string, eventId: string) {
  return {
    eventId,
    version: 'v1',
    type: 'HackathonArchived',
    occurredAt: new Date().toISOString(),
    actorId: null,
    payload: { hackathonId: id, archivedAt: new Date().toISOString() },
  };
}

describe('SyncService — organizer push ingestion', () => {
  let sync: SyncService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService, SyncService],
    }).compile();
    sync = module.get<SyncService>(SyncService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('consumes a published event into a PUBLISHED record with the same id', async () => {
    const res: any = await sync.consume(publishedEvent('hack-1', 'evt-1'));
    expect(res.hackathonId).toBe('hack-1');
    const stored = await (prisma.hackathon as any).findUnique({ where: { id: 'hack-1' } });
    expect(stored.status).toBe('PUBLISHED');
    expect(stored.title).toBe('Hack hack-1');
  });

  it('dedupes repeat delivery of the same eventId', async () => {
    await sync.consume(publishedEvent('hack-1', 'evt-1'));
    const res: any = await sync.consume(publishedEvent('hack-1', 'evt-1'));
    expect(res.deduped).toBe(true);
  });

  it('rejects malformed events without writing records', async () => {
    await expect(sync.consume({ type: 'HackathonPublished' })).rejects.toMatchObject({ status: 400 });
  });

  it('flips a known record to ARCHIVED on archived events', async () => {
    await sync.consume(publishedEvent('hack-1', 'evt-1'));
    const res: any = await sync.consume(archivedEvent('hack-1', 'evt-2'));
    expect(res.deduped).toBe(false);
    const stored = await (prisma.hackathon as any).findUnique({ where: { id: 'hack-1' } });
    expect(stored.status).toBe('ARCHIVED');
  });

  it('applies a newest-first outbox batch chronologically so archived hackathons stay archived', async () => {
    const published = { ...publishedEvent('hack-2', 'evt-p'), occurredAt: '2026-10-01T10:00:00.000Z' };
    const archived = { ...archivedEvent('hack-2', 'evt-a'), occurredAt: '2026-10-01T11:00:00.000Z' };
    await sync.consumeMany([archived, published]);
    const stored = await (prisma.hackathon as any).findUnique({ where: { id: 'hack-2' } });
    expect(stored.status).toBe('ARCHIVED');
  });

  it('acknowledges archived events for unknown ids without fabricating records', async () => {
    const res: any = await sync.consume(archivedEvent('ghost', 'evt-9'));
    expect(res.hackathonId).toBe('ghost');
    const stored = await (prisma.hackathon as any).findUnique({ where: { id: 'ghost' } });
    expect(stored).toBeNull();
  });
});

describe('SyncAuthGuard — shared secret only', () => {
  const SECRET = 'test-sync-secret-32-chars-minimum!!';

  beforeEach(() => {
    process.env.SYNC_SHARED_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.SYNC_SHARED_SECRET;
  });

  function ctxWith(headers: Record<string, string>): any {
    return { switchToHttp: () => ({ getRequest: () => ({ headers }) }) };
  }

  it('accepts the correct shared secret', () => {
    expect(new SyncAuthGuard().canActivate(ctxWith({ 'x-sync-secret': SECRET }))).toBe(true);
  });

  it('rejects a wrong or missing secret', () => {
    const guard = new SyncAuthGuard();
    expect(() => guard.canActivate(ctxWith({ 'x-sync-secret': 'wrong' }))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctxWith({}))).toThrow(UnauthorizedException);
  });

  it('rejects any bearer token without the secret, so self-registered organizers cannot forge sync events', () => {
    expect(() => new SyncAuthGuard().canActivate(ctxWith({ authorization: 'Bearer organizer.jwt.token' }))).toThrow(
      UnauthorizedException,
    );
  });
});
