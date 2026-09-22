import { randomUUID } from 'crypto';
import type { HackathonResource, ResourceVisibility, ResourceType } from '../../domain/types';
import { memoryStore } from '../../store/memory.store';
import { auditService } from '../audit/audit.service';

export interface CreateResourceDto {
  title: string;
  type?: ResourceType;
  url?: string | null;
  content?: string | null;
  visibility: ResourceVisibility;
}

export class ResourcesService {
  async create(hackathonId: string, organizerId: string, dto: CreateResourceDto): Promise<HackathonResource> {
    const hackathon = memoryStore.hackathons.get(hackathonId);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    if (hackathon.organizerId !== organizerId) {
      const user = memoryStore.users.get(organizerId);
      if (user?.role !== 'ADMIN') throw Object.assign(new Error('Not owner'), { statusCode: 403 });
    }
    if (!dto.title?.trim()) throw Object.assign(new Error('title required'), { statusCode: 400 });
    if (!['PUBLIC', 'PARTICIPANT', 'MENTOR', 'ORGANIZER'].includes(dto.visibility)) {
      throw Object.assign(new Error('Invalid visibility'), { statusCode: 400 });
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const resource: HackathonResource = {
      id,
      hackathonId,
      title: dto.title.trim(),
      type: (dto.type as ResourceType) ?? 'OTHER',
      url: dto.url ?? null,
      content: dto.content ?? null,
      visibility: dto.visibility,
      createdAt: now,
      updatedAt: now,
    };
    memoryStore.resources.set(id, resource);
    await auditService.log({
      actorId: organizerId,
      actorRole: 'ORGANIZER',
      action: 'resource.created',
      resourceType: 'resource',
      resourceId: id,
      outcome: 'success',
      metadata: { hackathonId, title: dto.title, visibility: dto.visibility },
    });
    return resource;
  }

  async list(hackathonId: string, requester: { id: string; role: string }): Promise<HackathonResource[]> {
    const hackathon = memoryStore.hackathons.get(hackathonId);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });

    let all = Array.from(memoryStore.resources.values()).filter((r) => r.hackathonId === hackathonId);

    // Visibility filtering
    // ORGANIZER and ADMIN see all
    if (['ORGANIZER', 'ADMIN'].includes(requester.role)) {
      // If organizer but not owner, they see only PUBLIC/PARTICIPANT? For simplicity, owner sees all, other organizer sees PUBLIC only
      const hackathon2 = hackathon;
      if (requester.role === 'ORGANIZER' && hackathon2.organizerId !== requester.id) {
        all = all.filter((r) => r.visibility === 'PUBLIC');
      }
      return all;
    }
    if (requester.role === 'MENTOR') {
      // Check if mentor assigned to this hackathon
      const assigned = Array.from(memoryStore.mentorAssignments.values()).some((a) => a.hackathonId === hackathonId && a.mentorId === requester.id);
      if (assigned) {
        return all.filter((r) => ['PUBLIC', 'PARTICIPANT', 'MENTOR'].includes(r.visibility));
      }
      return all.filter((r) => r.visibility === 'PUBLIC');
    }
    if (requester.role === 'PARTICIPANT') {
      return all.filter((r) => ['PUBLIC', 'PARTICIPANT'].includes(r.visibility));
    }
    // unauth -> public only
    return all.filter((r) => r.visibility === 'PUBLIC');
  }

  async getById(id: string): Promise<HackathonResource | null> {
    return memoryStore.resources.get(id) ?? null;
  }

  async update(id: string, organizerId: string, updates: Partial<CreateResourceDto>): Promise<HackathonResource> {
    const res = memoryStore.resources.get(id);
    if (!res) throw Object.assign(new Error('Resource not found'), { statusCode: 404 });
    const hackathon = memoryStore.hackathons.get(res.hackathonId);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    if (hackathon.organizerId !== organizerId) {
      const user = memoryStore.users.get(organizerId);
      if (user?.role !== 'ADMIN') throw Object.assign(new Error('Not owner'), { statusCode: 403 });
    }
    const updated: HackathonResource = {
      ...res,
      title: updates.title ?? res.title,
      type: (updates.type as ResourceType) ?? res.type,
      url: updates.url !== undefined ? updates.url : res.url,
      content: updates.content !== undefined ? updates.content : res.content,
      visibility: (updates.visibility as ResourceVisibility) ?? res.visibility,
      updatedAt: new Date().toISOString(),
    };
    memoryStore.resources.set(id, updated);
    await auditService.log({
      actorId: organizerId,
      actorRole: 'ORGANIZER',
      action: 'resource.updated',
      resourceType: 'resource',
      resourceId: id,
      outcome: 'success',
      metadata: { updatedFields: Object.keys(updates) },
    });
    return updated;
  }

  async delete(id: string, organizerId: string): Promise<void> {
    const res = memoryStore.resources.get(id);
    if (!res) throw Object.assign(new Error('Resource not found'), { statusCode: 404 });
    const hackathon = memoryStore.hackathons.get(res.hackathonId);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    if (hackathon.organizerId !== organizerId) {
      const user = memoryStore.users.get(organizerId);
      if (user?.role !== 'ADMIN') throw Object.assign(new Error('Not owner'), { statusCode: 403 });
    }
    memoryStore.resources.delete(id);
    await auditService.log({
      actorId: organizerId,
      actorRole: 'ORGANIZER',
      action: 'resource.deleted',
      resourceType: 'resource',
      resourceId: id,
      outcome: 'success',
      metadata: { hackathonId: res.hackathonId },
    });
  }
}

export const resourcesService = new ResourcesService();
