import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SyncAuthGuard } from './sync-auth.guard';
import { PrismaService } from '../database/prisma.service';
import { SyncService } from './sync.service';

@ApiTags('sync')
@ApiBearerAuth()
@Controller('sync')
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly prisma: PrismaService,
  ) {}

  /** Consume a single versioned HackathonPublished event (idempotent). */
  @Post('consume')
  @UseGuards(SyncAuthGuard)
  async consume(@Body() event: unknown) {
    return this.sync.consume(event);
  }

  /** Batch consume (e.g. drained from organizer GET /sync/outbox). */
  @Post('consume-batch')
  @UseGuards(SyncAuthGuard)
  async consumeBatch(@Body() body: { events: unknown[] }) {
    const events = Array.isArray(body?.events) ? body.events : [];
    return { results: await this.sync.consumeMany(events) };
  }

  /** Pull organizer outbox over HTTP and consume (same ID end-to-end). */
  @Post('pull')
  @UseGuards(JwtAuthGuard)
  async pull(@Body() body: { organizerBaseUrl: string; token?: string; limit?: number }) {
    const base = (body?.organizerBaseUrl || '').replace(/\/$/, '');
    if (!base) throw Object.assign(new Error('organizerBaseUrl required'), { status: 400 });
    const limit = Math.min(200, Math.max(1, Number(body?.limit ?? 50)));
    const res = await fetch(`${base}/sync/outbox?limit=${limit}`, {
      headers: {
        ...(body?.token ? { Authorization: `Bearer ${body.token}` } : {}),
      },
    });
    if (!res.ok) throw Object.assign(new Error(`Organizer outbox fetch failed: ${res.status}`), { status: 502 });
    const json: any = await res.json();
    const outbox: any[] = json?.data ?? json ?? [];
    // Outbox rows carry { eventId, type, payload } — rehydrate to full events.
    const events = outbox.map((row: any) =>
      row?.type === 'HackathonPublished' && row?.payload && !row?.payload?.hackathonId
        ? row
        : row?.payload?.hackathonId
          ? {
              eventId: row.eventId,
              version: 'v1',
              type: 'HackathonPublished',
              occurredAt: row.occurredAt ?? new Date().toISOString(),
              actorId: null,
              payload: row.payload,
            }
          : row,
    );
    return { results: await this.sync.consumeMany(events) };
  }

  @Get('consumed')
  @UseGuards(JwtAuthGuard)
  async consumed() {
    const all = await (this.prisma as any).consumedEvent
      ? { note: 'see hackathon list for consumed records' }
      : null;
    return all;
  }
}
