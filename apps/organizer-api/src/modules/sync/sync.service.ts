import { memoryStore } from '../../store/memory.store';
import type { HackathonPublishedEvent } from '../../domain/types';

export class SyncService {
  async getPublishedEvent(hackathonId: string): Promise<HackathonPublishedEvent | null> {
    const hackathon = memoryStore.hackathons.get(hackathonId);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    if (hackathon.status !== 'PUBLISHED' && hackathon.status !== 'ARCHIVED') {
      throw Object.assign(new Error('Hackathon not yet published'), { statusCode: 400 });
    }
    const event = memoryStore.publishedEvents.get(hackathonId);
    if (!event) throw Object.assign(new Error('Published event not found'), { statusCode: 404 });
    return event;
  }

  async getParticipantContext(hackathonId: string): Promise<any> {
    const event = await this.getPublishedEvent(hackathonId);
    if (!event) return null;
    const p = event.payload;
    const participantResources = p.resources.filter((r) => ['PUBLIC', 'PARTICIPANT'].includes(r.visibility));
    return {
      hackathonId: p.hackathonId,
      slug: p.slug,
      title: p.title,
      description: p.description,
      hackathonType: p.hackathonType,
      problemStatement: p.problemStatement,
      resources: participantResources,
      rules: p.rules,
      phases: p.phases,
      judgingCriteria: p.judgingCriteria,
      theme: p.theme,
      announcements: p.announcements,
      version: event.version,
      publishedAt: p.publishedAt,
      hackathonVersion: p.hackathonVersion,
    };
  }

  async listPublishedEvents(): Promise<HackathonPublishedEvent[]> {
    return Array.from(memoryStore.publishedEvents.values()).sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  }

  async consumeAsParticipant(hackathonId: string, _participantId: string): Promise<{ consumed: boolean; contract: any; warning?: string }> {
    const context = await this.getParticipantContext(hackathonId);
    if (!context) throw Object.assign(new Error('No published context'), { statusCode: 404 });
    return {
      consumed: true,
      contract: context,
      warning: 'Do NOT directly modify participant database tables via organizer API. Use this versioned contract.',
    };
  }

  getContractSchema() {
    return {
      version: 'v1',
      type: 'HackathonPublished',
      fields: ['hackathonId', 'slug', 'title', 'description', 'hackathonType', 'problemStatement', 'resources', 'rules', 'phases', 'judgingCriteria', 'theme', 'announcements'],
      note: 'Participant backend must consume via this versioned contract, not direct DB access',
    };
  }
}

export const syncService = new SyncService();
