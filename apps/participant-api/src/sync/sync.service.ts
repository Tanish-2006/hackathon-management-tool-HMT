import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { hackathonArchivedSchema, hackathonPublishedSchema } from '@hmt/contracts';

/**
 * Sync consumer — organizer → participant canonical transport.
 * Consumes versioned HackathonPublished events (via POST /sync/consume or
 * poll of organizer GET /sync/published|outbox) and upserts the SAME
 * hackathonId/slug into the participant read-model. Idempotent by eventId.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  constructor(private readonly prisma: PrismaService) {}

  async consumePublishedEvent(event: unknown) {
    const parsed = hackathonPublishedSchema.safeParse(event);
    if (!parsed.success) {
      throw Object.assign(new Error('Invalid HackathonPublished event'), {
        status: 400,
        details: parsed.error.issues,
      });
    }
    const evt = parsed.data;
    const existing = await this.prisma.consumedEvent.findUnique({
      where: { eventId: evt.eventId },
    } as any);
    if (existing) {
      return { deduped: true, eventId: evt.eventId, hackathonId: evt.payload.hackathonId };
    }
    const p = evt.payload as any;
    const data = {
      id: p.hackathonId,
      slug: p.slug,
      title: p.title,
      description: p.description ?? '',
      mode: p.mode ?? 'ONLINE',
      status: 'PUBLISHED',
      isPublished: true,
      hackathonType: p.hackathonType ?? 'OPEN_INNOVATION',
      organizer: p.organizerName ?? null,
      organizerName: p.organizerName ?? null,
      problemStatement: p.problemStatement ?? null,
      rules: p.rules ?? [],
      resources: (p.resources ?? []).map((r: any) => ({
        name: r.title,
        url: r.url,
        visibility: r.visibility,
      })),
      judgingCriteria: p.judgingCriteria ?? [],
      phases: (p.phases ?? []).map((ph: any) => ({
        name: ph.name,
        startsAt: ph.startsAt,
        endsAt: ph.endsAt,
        status: ph.status ?? 'UPCOMING',
      })),
      category: p.category ?? p.theme ?? null,
      tags: p.tags ?? [],
      eligibility: p.eligibility ?? [],
      teamSize: p.teamSize ?? null,
      registrationStart: p.registrationStart ?? null,
      registrationEnd: p.registrationEnd ?? null,
      eventStart: p.eventStart ?? null,
      eventEnd: p.eventEnd ?? null,
      startDate: p.eventStart ?? null,
      endDate: p.eventEnd ?? null,
      publishedAt: p.publishedAt,
      theme: p.theme ?? null,
    };
    await (this.prisma.hackathon as any).upsert({
      where: { id: p.hackathonId },
      update: { ...data, updatedAt: new Date() },
      create: data,
    });
    await this.prisma.consumedEvent.create({
      data: { eventId: evt.eventId, hackathonId: p.hackathonId },
    } as any);
    this.logger.log(`Consumed HackathonPublished ${p.hackathonId} (${evt.eventId})`);
    return { deduped: false, eventId: evt.eventId, hackathonId: p.hackathonId };
  }

  async consumeMany(events: unknown[]) {
    const results: Array<Record<string, unknown>> = [];
    for (const e of events) {
      try {
        results.push({ ok: true, ...(await this.consume(e)) });
      } catch (err: any) {
        results.push({ ok: false, error: err?.message ?? 'consume failed' });
      }
    }
    return results;
  }

  /** Dispatch by event type; unknown types fall through to the published path. */
  async consume(event: unknown) {
    const type = (event as any)?.type;
    if (type === 'HackathonArchived') return this.consumeArchivedEvent(event);
    return this.consumePublishedEvent(event);
  }

  /**
   * Apply a HackathonArchived event: flip a known record to ARCHIVED so it
   * drops out of active discovery while detail/history still resolve.
   * Idempotent by eventId, same as the published path. Unknown hackathon IDs
   * are acknowledged without effect (never fabricate records here).
   */
  async consumeArchivedEvent(event: unknown) {
    const parsed = hackathonArchivedSchema.safeParse(event);
    if (!parsed.success) {
      throw Object.assign(new Error('Invalid HackathonArchived event'), {
        status: 400,
        details: parsed.error.issues,
      });
    }
    const evt = parsed.data;
    const existing = await this.prisma.consumedEvent.findUnique({
      where: { eventId: evt.eventId },
    } as any);
    if (existing) {
      return { deduped: true, eventId: evt.eventId, hackathonId: evt.payload.hackathonId };
    }
    const record = await (this.prisma.hackathon as any).findUnique?.({
      where: { id: evt.payload.hackathonId },
    }).catch(() => null);
    if (record) {
      await (this.prisma.hackathon as any).update({
        where: { id: evt.payload.hackathonId },
        data: { status: 'ARCHIVED', updatedAt: new Date() },
      });
    }
    await this.prisma.consumedEvent.create({
      data: { eventId: evt.eventId, hackathonId: evt.payload.hackathonId },
    } as any);
    this.logger.log(`Consumed HackathonArchived ${evt.payload.hackathonId} (${evt.eventId})`);
    return { deduped: false, eventId: evt.eventId, hackathonId: evt.payload.hackathonId };
  }
}
