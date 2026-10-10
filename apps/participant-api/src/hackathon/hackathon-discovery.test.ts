import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { HackathonController, assertPublishedForParticipants } from './hackathon.controller';
import { SyncService } from '../sync/sync.service';

function publishedPayload(id: string, title: string) {
  return {
    eventId: `evt-${id}`,
    version: 'v1',
    type: 'HackathonPublished',
    occurredAt: new Date().toISOString(),
    actorId: null,
    payload: {
      hackathonId: id,
      slug: `slug-${id}`,
      title,
      description: `${title} description`,
      hackathonType: 'HYBRID',
      objective: `${title} objective`,
      audience: 'Students',
      mode: 'HYBRID',
      themeIds: ['theme-1'],
      problemStatement: `${title} problem`,
      constraints: ['Original work only'],
      expectedOutcomes: ['Prototype'],
      rules: ['Rule 1'],
      resources: [{ id: 'r1', title: 'Starter Kit', type: 'STARTER', url: null, visibility: 'PUBLIC' }],
      phases: [{ phaseId: 'ph1', name: 'development', startsAt: '2026-11-01T09:00:00.000Z', endsAt: '2026-11-03T18:00:00.000Z', order: 1 }],
      judgingCriteria: [{ id: 'c1', name: 'Innovation', weight: 1, maxScore: 10 }],
      theme: 'Artificial Intelligence',
      announcements: [],
      publishedAt: new Date().toISOString(),
      hackathonVersion: 1,
      registrationStart: null,
      registrationEnd: null,
      eventStart: '2026-11-01T09:00:00.000Z',
      eventEnd: '2026-11-03T18:00:00.000Z',
      eligibility: ['Students'],
      teamSize: { min: 1, max: 4 },
    },
  };
}

describe('participant discovery — published-only visibility', () => {
  let prisma: PrismaService;
  let controller: HackathonController;
  let sync: SyncService;

  beforeEach(() => {
    prisma = new PrismaService();
    controller = new HackathonController(prisma);
    sync = new SyncService(prisma);
  });

  async function seedStatuses() {
    for (const st of ['DRAFT', 'REVIEW', 'CONFIRMED', 'PUBLISHED', 'ARCHIVED'] as const) {
      await (prisma.hackathon as any).create({
        data: { id: `hack-${st}`, title: `Hack ${st}`, description: `${st} hack`, status: st },
      });
    }
  }

  it('default discovery exposes ONLY the PUBLISHED hackathon', async () => {
    await seedStatuses();
    const res = await controller.listHackathons();
    const statuses = res.data.map((h: any) => h.status);
    expect(statuses).toEqual(['PUBLISHED']);
  });

  it('search finds the published hackathon but never drafts', async () => {
    await seedStatuses();
    const found = await controller.listHackathons('Hack PUBLISHED');
    expect(found.data.map((h: any) => h.id)).toEqual(['hack-PUBLISHED']);
    const hidden = await controller.listHackathons('Hack DRAFT');
    expect(hidden.data).toHaveLength(0);
  });
  
  it('detail resolves PUBLISHED and ARCHIVED, 404s DRAFT/REVIEW/CONFIRMED', async () => {
    await seedStatuses();
    await expect(controller.getHackathonById('hack-PUBLISHED')).resolves.toMatchObject({ id: 'hack-PUBLISHED' });
    await expect(controller.getHackathonById('hack-ARCHIVED')).resolves.toMatchObject({ id: 'hack-ARCHIVED' });
    for (const st of ['DRAFT', 'REVIEW', 'CONFIRMED']) {
      await expect(controller.getHackathonById('hack-' + st)).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it('assertPublishedForParticipants allows PUBLISHED/ARCHIVED only', () => {
    expect(() => assertPublishedForParticipants({ status: 'PUBLISHED' })).not.toThrow();
    expect(() => assertPublishedForParticipants({ status: 'ARCHIVED' })).not.toThrow();
    for (const st of ['DRAFT', 'REVIEW', 'CONFIRMED']) {
      expect(() => assertPublishedForParticipants({ status: st })).toThrow(NotFoundException);
    }
    expect(() => assertPublishedForParticipants({ isPublished: false })).toThrow(NotFoundException);
  });

  it('consumed published events land PUBLISHED with full public payload, never client status', async () => {
    await sync.consume(publishedPayload('hack-1', 'HMT InnovateX AI Challenge 2026'));
    const stored: any = await (prisma.hackathon as any).findUnique({ where: { id: 'hack-1' } });
    expect(stored.status).toBe('PUBLISHED');
    expect(stored.isPublished).toBe(true);
    expect(stored.title).toBe('HMT InnovateX AI Challenge 2026');
    expect(stored.objective).toContain('objective');
    expect(stored.audience).toBe('Students');
    expect(stored.constraints).toEqual(['Original work only']);
    expect(stored.expectedOutcomes).toEqual(['Prototype']);
    expect(stored.theme).toBe('Artificial Intelligence');
    expect(stored.phases).toHaveLength(1);
    expect(stored.judgingCriteria).toHaveLength(1);
    const res = await controller.listHackathons('InnovateX');
    expect(res.data.map((h: any) => h.id)).toContain('hack-1');
  });

  it('duplicate delivery does not duplicate records (idempotent by eventId)', async () => {
    const evt = publishedPayload('hack-dup', 'Dup Hack');
    await sync.consume(evt);
    const again: any = await sync.consume(evt);
    expect(again.deduped).toBe(true);
    const res = await controller.listHackathons('Dup Hack');
    expect(res.data.filter((h: any) => h.id === 'hack-dup')).toHaveLength(1);
  });

  it('re-published updates with a new eventId propagate without duplicating', async () => {
    await sync.consume(publishedPayload('hack-upd', 'Update Me v1'));
    const v2 = publishedPayload('hack-upd', 'Update Me v2');
    (v2 as any).eventId = 'evt-hack-upd-2';
    await sync.consume(v2);
    const stored: any = await (prisma.hackathon as any).findUnique({ where: { id: 'hack-upd' } });
    expect(stored.title).toBe('Update Me v2');
    const res = await controller.listHackathons('Update Me');
    expect(res.data.filter((h: any) => h.id === 'hack-upd')).toHaveLength(1);
  });

  it('archived hackathons drop out of active discovery while detail history still resolves', async () => {
    await sync.consume(publishedPayload('hack-arch', 'Archive Me'));
    expect((await controller.listHackathons('Archive Me')).data.map((h: any) => h.id)).toContain('hack-arch');
    await sync.consume({
      eventId: 'evt-hack-arch-2',
      version: 'v1',
      type: 'HackathonArchived',
      occurredAt: new Date().toISOString(),
      actorId: null,
      payload: { hackathonId: 'hack-arch', archivedAt: new Date().toISOString() },
    });
    const res = await controller.listHackathons('Archive Me');
    expect(res.data.map((h: any) => h.id)).not.toContain('hack-arch');
    await expect(controller.getHackathonById('hack-arch')).resolves.toMatchObject({ id: 'hack-arch' });
  });
});
