import { randomUUID } from 'crypto';
import type { Hackathon, HackathonPhase } from '../../domain/types';
import { memoryStore } from '../../store/memory.store';
import { auditService } from '../audit/audit.service';

/**
 * Enforce the explicit event window when one is configured. All comparisons
 * use epoch milliseconds (UTC instants); no calendar math, no locale parsing.
 * Throws 400 naming the violated bound. No-op for windowless hackathons.
 */
function assertPhaseInWindow(
  hackathon: Hackathon,
  startsAt: string,
  endsAt: string,
): void {
  const ws = hackathon.eventStart ? new Date(hackathon.eventStart).getTime() : null;
  const we = hackathon.eventEnd ? new Date(hackathon.eventEnd).getTime() : null;
  if (ws === null || we === null || Number.isNaN(ws) || Number.isNaN(we)) return;
  const s = new Date(startsAt).getTime();
  const e = new Date(endsAt).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return; // date-shape errors belong to validateSingle
  if (s < ws) {
    throw Object.assign(
      new Error(`Phase starts before the event (${hackathon.eventStart})`),
      { statusCode: 400 },
    );
  }
  if (e > we) {
    throw Object.assign(
      new Error(`Phase ends after the event (${hackathon.eventEnd})`),
      { statusCode: 400 },
    );
  }
}

export interface CreatePhaseDto {
  name: string;
  order: number;
  startsAt: string;
  endsAt: string;
  description?: string | null;
}

export class TimelineService {
  async create(hackathonId: string, organizerId: string, dto: CreatePhaseDto): Promise<HackathonPhase> {
    const hackathon = memoryStore.hackathons.get(hackathonId);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    if (hackathon.organizerId !== organizerId) {
      const user = memoryStore.users.get(organizerId);
      if (user?.role !== 'ADMIN') throw Object.assign(new Error('Not owner'), { statusCode: 403 });
    }
    this.validateSingle(dto);
    // Containment: when the hackathon declares an explicit event window,
    // phases must fit completely inside it. Windowless hackathons keep the
    // legacy sequential/no-overlap checks only (backward compatible).
    assertPhaseInWindow(hackathon, dto.startsAt, dto.endsAt);
    // Check duplicate order
    const existing = Array.from(memoryStore.phases.values()).filter((p) => p.hackathonId === hackathonId);
    if (existing.some((p) => p.order === dto.order)) {
      throw Object.assign(new Error(`Phase order ${dto.order} already exists`), { statusCode: 400 });
    }
    // Validate timeline with new phase added
    const all = [
      ...existing.map((p) => ({ startsAt: p.startsAt, endsAt: p.endsAt, order: p.order })),
      { startsAt: dto.startsAt, endsAt: dto.endsAt, order: dto.order },
    ];
    const validation = memoryStore.validateTimeline(all);
    if (!validation.valid) throw Object.assign(new Error(validation.error), { statusCode: 400 });

    const id = randomUUID();
    const now = new Date().toISOString();
    const phase: HackathonPhase = {
      id,
      hackathonId,
      name: dto.name,
      order: dto.order,
      startsAt: new Date(dto.startsAt).toISOString(),
      endsAt: new Date(dto.endsAt).toISOString(),
      description: dto.description ?? null,
      status: 'UPCOMING',
      createdAt: now,
      updatedAt: now,
    };
    memoryStore.phases.set(id, phase);
    await auditService.log({
      actorId: organizerId,
      actorRole: 'ORGANIZER',
      action: 'phase.created',
      resourceType: 'phase',
      resourceId: id,
      outcome: 'success',
      metadata: { hackathonId, name: dto.name, order: dto.order },
    });
    return phase;
  }

  async list(hackathonId: string): Promise<HackathonPhase[]> {
    const hackathon = memoryStore.hackathons.get(hackathonId);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    return Array.from(memoryStore.phases.values())
      .filter((p) => p.hackathonId === hackathonId)
      .sort((a, b) => a.order - b.order);
  }

  async update(phaseId: string, organizerId: string, updates: Partial<CreatePhaseDto>): Promise<HackathonPhase> {
    const phase = memoryStore.phases.get(phaseId);
    if (!phase) throw Object.assign(new Error('Phase not found'), { statusCode: 404 });
    const hackathon = memoryStore.hackathons.get(phase.hackathonId);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    if (hackathon.organizerId !== organizerId) {
      const user = memoryStore.users.get(organizerId);
      if (user?.role !== 'ADMIN') throw Object.assign(new Error('Not owner'), { statusCode: 403 });
    }

    const newStartsAt = updates.startsAt ?? phase.startsAt;
    const newEndsAt = updates.endsAt ?? phase.endsAt;
    const newOrder = updates.order ?? phase.order;
    const newName = updates.name ?? phase.name;
    const newDescription = updates.description !== undefined ? updates.description : phase.description;

    this.validateSingle({ name: newName, order: newOrder, startsAt: newStartsAt, endsAt: newEndsAt });
    assertPhaseInWindow(hackathon, newStartsAt, newEndsAt);

    // Check order collision if changed
    if (newOrder !== phase.order) {
      const existing = Array.from(memoryStore.phases.values()).filter((p) => p.hackathonId === phase.hackathonId && p.id !== phaseId);
      if (existing.some((p) => p.order === newOrder)) throw Object.assign(new Error(`Phase order ${newOrder} already exists`), { statusCode: 400 });
    }

    // Validate timeline
    const allPhases = Array.from(memoryStore.phases.values())
      .filter((p) => p.hackathonId === phase.hackathonId)
      .map((p) => (p.id === phaseId ? { startsAt: newStartsAt, endsAt: newEndsAt, order: newOrder } : { startsAt: p.startsAt, endsAt: p.endsAt, order: p.order }));
    const validation = memoryStore.validateTimeline(allPhases);
    if (!validation.valid) throw Object.assign(new Error(validation.error), { statusCode: 400 });

    const updated: HackathonPhase = {
      ...phase,
      name: newName,
      order: newOrder,
      startsAt: new Date(newStartsAt).toISOString(),
      endsAt: new Date(newEndsAt).toISOString(),
      description: newDescription ?? null,
      updatedAt: new Date().toISOString(),
    };
    memoryStore.phases.set(phaseId, updated);
    await auditService.log({
      actorId: organizerId,
      actorRole: 'ORGANIZER',
      action: 'phase.updated',
      resourceType: 'phase',
      resourceId: phaseId,
      outcome: 'success',
      metadata: { updatedFields: Object.keys(updates) },
    });
    // Also log phase change for hackathon
    await auditService.log({
      actorId: organizerId,
      actorRole: 'ORGANIZER',
      action: 'hackathon.phase_changed',
      resourceType: 'hackathon',
      resourceId: hackathon.id,
      outcome: 'success',
      metadata: { phaseId, name: newName },
    });
    return updated;
  }

  async delete(phaseId: string, organizerId: string): Promise<void> {
    const phase = memoryStore.phases.get(phaseId);
    if (!phase) throw Object.assign(new Error('Phase not found'), { statusCode: 404 });
    const hackathon = memoryStore.hackathons.get(phase.hackathonId);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    if (hackathon.organizerId !== organizerId) {
      const user = memoryStore.users.get(organizerId);
      if (user?.role !== 'ADMIN') throw Object.assign(new Error('Not owner'), { statusCode: 403 });
    }
    memoryStore.phases.delete(phaseId);
    await auditService.log({
      actorId: organizerId,
      actorRole: 'ORGANIZER',
      action: 'phase.deleted',
      resourceType: 'phase',
      resourceId: phaseId,
      outcome: 'success',
      metadata: { hackathonId: phase.hackathonId },
    });
  }

  private validateSingle(dto: { name: string; order: number; startsAt: string; endsAt: string }) {
    if (!dto.name?.trim()) throw Object.assign(new Error('Phase name required'), { statusCode: 400 });
    // Validate known phases but allow custom
    // Do not hardcode only known phases; any string is allowed but we could warn if not in known list
    if (typeof dto.order !== 'number' || dto.order < 1) throw Object.assign(new Error('Order must be >=1'), { statusCode: 400 });
    const s = new Date(dto.startsAt).getTime();
    const e = new Date(dto.endsAt).getTime();
    if (isNaN(s) || isNaN(e)) throw Object.assign(new Error('Invalid start/end date'), { statusCode: 400 });
    if (s >= e) throw Object.assign(new Error('startsAt must be before endsAt'), { statusCode: 400 });
    // Prevent invalid timelines early
  }
}

export const timelineService = new TimelineService();
