import { BadGatewayException, BadRequestException, Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { resolveSyncSecret } from '@hmt/config';
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

  @Put('ideation/:hackathonId')
  @UseGuards(SyncAuthGuard)
  async ideation(@Param('hackathonId') hackathonId: string, @Body() config: unknown) {
    return this.sync.setIdeation(hackathonId, config);
  }

  /** Batch consume (e.g. drained from organizer GET /sync/outbox). */
  @Post('consume-batch')
  @UseGuards(SyncAuthGuard)
  async consumeBatch(@Body() body: { events: unknown[] }) {
    if (!body || !Array.isArray((body as any)?.events)) {
      throw new BadRequestException('Invalid batch: events must be an array');
    }
    const events = (body as any).events as unknown[];
    if (events.length > 100) {
      throw new BadRequestException('Invalid batch: max 100 events per request');
    }
    return { results: await this.sync.consumeMany(events) };
  }

  /** Pull organizer outbox over HTTP and consume (same ID end-to-end). */
  @Post('pull')
  @UseGuards(JwtAuthGuard)
  async pull(@Body() body: { organizerBaseUrl?: string; token?: string; limit?: number }) {
    // Server defaults so the frontend never needs to know the organizer
    // address: ORGANIZER_API_URL env, else the documented local default.
    // Auth prefers the server-to-server shared secret (organizer outbox
    // accepts x-sync-secret); an explicit caller token still works as fallback.
    const fallbackBase =
      process.env.ORGANIZER_API_URL?.replace(/\/$/, '') || 'http://localhost:3002/api/v1';
    const rawBase = body?.organizerBaseUrl || fallbackBase;
    const base = String(rawBase).replace(/\/$/, '');
    // SSRF guard: only http(s) to non-private hosts. Attacker-controlled
    // organizerBaseUrl must never reach metadata/cloud-internal addresses,
    // and the server secret must never be sent to an untrusted host.
    let parsed: URL;
    try {
      parsed = new URL(base);
    } catch {
      throw new BadRequestException('Invalid organizerBaseUrl');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('Invalid organizerBaseUrl: only http(s) allowed');
    }
    const host = parsed.hostname.toLowerCase();
    const isLoopback =
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0';
    const isPrivateNet =
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host.endsWith('.internal');
    const isMetadata = host === '169.254.169.254' || host === 'metadata.google.internal';
    // Cloud metadata is never allowed (secret would leak to it).
    if (isMetadata) {
      throw new BadRequestException('Invalid organizerBaseUrl: private/internal hosts are not allowed');
    }
    const isCallerSupplied = Boolean(body?.organizerBaseUrl);
    if (isCallerSupplied && (isLoopback || isPrivateNet)) {
      // Caller-supplied URLs must be public — prevents SSRF to internal
      // services and prevents the server secret reaching attacker hosts
      // that resolve to internal addresses.
      throw new BadRequestException('Invalid organizerBaseUrl: private/internal hosts are not allowed');
    }
    const rawLimit = Number((body as any)?.limit ?? 50);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 200) : 50;
    // Effective secret (explicit config or non-prod dev default) so the
    // organizer outbox accepts this server-to-server pull call.
    const secret = resolveSyncSecret();
    // 8s timeout so a hung organizer cannot hang the participant worker.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(`${base}/sync/outbox?limit=${limit}`, {
        signal: ctrl.signal,
        headers: {
          ...(secret ? { 'x-sync-secret': secret } : {}),
          ...(body?.token ? { Authorization: `Bearer ${body.token}` } : {}),
        },
      });
    } catch (e) {
      throw new BadGatewayException(`Organizer outbox fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new BadGatewayException(`Organizer outbox fetch failed: ${res.status}`);
    const json: any = await res.json().catch(() => null);
    const outbox: any[] = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json)
        ? json
        : [];
    // Outbox rows carry { eventId, type, payload } — rehydrate to full events,
    // preserving the row type (published AND archived) for the dispatcher.
    const events = outbox.map((row: any) =>
      row?.payload?.hackathonId
        ? {
            eventId: row.eventId,
            version: 'v1',
            type: row.type ?? 'HackathonPublished',
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
