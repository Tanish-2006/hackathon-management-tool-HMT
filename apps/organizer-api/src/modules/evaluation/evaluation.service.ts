import { randomUUID } from 'crypto';
import type { EvaluationCriteria } from '../../domain/types';
import { memoryStore } from '../../store/memory.store';
import { auditService } from '../audit/audit.service';

export interface CreateCriteriaDto {
  name: string;
  description?: string | null;
  weight: number;
  maxScore: number;
}

export class EvaluationService {
  async create(hackathonId: string, organizerId: string, dto: CreateCriteriaDto): Promise<EvaluationCriteria> {
    const hackathon = memoryStore.hackathons.get(hackathonId);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    if (hackathon.organizerId !== organizerId) {
      const user = memoryStore.users.get(organizerId);
      if (user?.role !== 'ADMIN') throw Object.assign(new Error('Not owner'), { statusCode: 403 });
    }
    if (!dto.name?.trim()) throw Object.assign(new Error('name required'), { statusCode: 400 });
    if (typeof dto.weight !== 'number' || dto.weight <= 0 || dto.weight > 1) throw Object.assign(new Error('weight must be 0 < weight <=1'), { statusCode: 400 });
    if (typeof dto.maxScore !== 'number' || dto.maxScore <= 0) throw Object.assign(new Error('maxScore must be >0'), { statusCode: 400 });

    // Do not hardcode criteria: allow any name, but ensure uniqueness per hackathon
    const existing = Array.from(memoryStore.evaluationCriteria.values()).filter((c) => c.hackathonId === hackathonId && c.name.toLowerCase() === dto.name.toLowerCase());
    if (existing.length > 0) throw Object.assign(new Error('Criteria with this name already exists for hackathon'), { statusCode: 409 });

    // Optional: validate total weight <=1
    const totalWeight = Array.from(memoryStore.evaluationCriteria.values())
      .filter((c) => c.hackathonId === hackathonId)
      .reduce((s, c) => s + c.weight, 0) + dto.weight;
    if (totalWeight > 1.01) {
      // warn but not block? We'll allow but audit
      // For strictness, block if >1
      throw Object.assign(new Error(`Total weight would exceed 1.0 (currently ${totalWeight.toFixed(2)})`), { statusCode: 400 });
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const criteria: EvaluationCriteria = {
      id,
      hackathonId,
      name: dto.name.trim(),
      description: dto.description ?? null,
      weight: dto.weight,
      maxScore: dto.maxScore,
      createdAt: now,
      updatedAt: now,
    };
    memoryStore.evaluationCriteria.set(id, criteria);
    await auditService.log({
      actorId: organizerId,
      actorRole: 'ORGANIZER',
      action: 'evaluation_criteria.created',
      resourceType: 'evaluation_criteria',
      resourceId: id,
      outcome: 'success',
      metadata: { hackathonId, name: dto.name, weight: dto.weight },
    });
    return criteria;
  }

  async list(hackathonId: string): Promise<EvaluationCriteria[]> {
    const hackathon = memoryStore.hackathons.get(hackathonId);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    return Array.from(memoryStore.evaluationCriteria.values())
      .filter((c) => c.hackathonId === hackathonId)
      .sort((a, b) => b.weight - a.weight);
  }

  async update(id: string, organizerId: string, updates: Partial<CreateCriteriaDto>): Promise<EvaluationCriteria> {
    const criteria = memoryStore.evaluationCriteria.get(id);
    if (!criteria) throw Object.assign(new Error('Criteria not found'), { statusCode: 404 });
    const hackathon = memoryStore.hackathons.get(criteria.hackathonId);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    if (hackathon.organizerId !== organizerId) {
      const user = memoryStore.users.get(organizerId);
      if (user?.role !== 'ADMIN') throw Object.assign(new Error('Not owner'), { statusCode: 403 });
    }

    const newName = updates.name ?? criteria.name;
    const newWeight = updates.weight ?? criteria.weight;
    const newMaxScore = updates.maxScore ?? criteria.maxScore;

    if (updates.name && Array.from(memoryStore.evaluationCriteria.values()).some((c) => c.hackathonId === criteria.hackathonId && c.id !== id && c.name.toLowerCase() === updates.name!.toLowerCase())) {
      throw Object.assign(new Error('Another criteria with this name exists'), { statusCode: 409 });
    }

    // Re-validate total weight
    const totalExcluding = Array.from(memoryStore.evaluationCriteria.values())
      .filter((c) => c.hackathonId === criteria.hackathonId && c.id !== id)
      .reduce((s, c) => s + c.weight, 0) + newWeight;
    if (totalExcluding > 1.01) throw Object.assign(new Error(`Total weight would exceed 1.0`), { statusCode: 400 });

    const updated: EvaluationCriteria = {
      ...criteria,
      name: newName,
      description: updates.description !== undefined ? updates.description : criteria.description,
      weight: newWeight,
      maxScore: newMaxScore,
      updatedAt: new Date().toISOString(),
    };
    memoryStore.evaluationCriteria.set(id, updated);
    await auditService.log({
      actorId: organizerId,
      actorRole: 'ORGANIZER',
      action: 'evaluation_criteria.updated',
      resourceType: 'evaluation_criteria',
      resourceId: id,
      outcome: 'success',
      metadata: { updatedFields: Object.keys(updates) },
    });
    return updated;
  }

  async delete(id: string, organizerId: string): Promise<void> {
    const criteria = memoryStore.evaluationCriteria.get(id);
    if (!criteria) throw Object.assign(new Error('Criteria not found'), { statusCode: 404 });
    const hackathon = memoryStore.hackathons.get(criteria.hackathonId);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    if (hackathon.organizerId !== organizerId) {
      const user = memoryStore.users.get(organizerId);
      if (user?.role !== 'ADMIN') throw Object.assign(new Error('Not owner'), { statusCode: 403 });
    }
    memoryStore.evaluationCriteria.delete(id);
    await auditService.log({
      actorId: organizerId,
      actorRole: 'ORGANIZER',
      action: 'evaluation_criteria.deleted',
      resourceType: 'evaluation_criteria',
      resourceId: id,
      outcome: 'success',
      metadata: { hackathonId: criteria.hackathonId },
    });
  }

  async getById(id: string): Promise<EvaluationCriteria | null> {
    return memoryStore.evaluationCriteria.get(id) ?? null;
  }
}

export const evaluationService = new EvaluationService();
