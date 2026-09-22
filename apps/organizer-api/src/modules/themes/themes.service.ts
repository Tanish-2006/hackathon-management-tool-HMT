import { randomUUID } from 'crypto';
import type { Theme } from '../../domain/types';
import { memoryStore } from '../../store/memory.store';
import { auditService } from '../audit/audit.service';

export class ThemesService {
  async create(name: string, createdById: string, description?: string): Promise<Theme> {
    const trimmed = name.trim();
    if (!trimmed) throw Object.assign(new Error('Theme name required'), { statusCode: 400 });
    const existing = Array.from(memoryStore.themes.values()).find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) throw Object.assign(new Error('Theme already exists'), { statusCode: 409 });
    const id = randomUUID();
    const theme: Theme = {
      id,
      name: trimmed,
      description: description ?? null,
      createdById,
      createdAt: new Date().toISOString(),
    };
    memoryStore.themes.set(id, theme);
    await auditService.log({
      actorId: createdById,
      actorRole: 'ORGANIZER',
      action: 'theme.created',
      resourceType: 'theme',
      resourceId: id,
      outcome: 'success',
      metadata: { name: trimmed },
    });
    return theme;
  }

  async list(): Promise<Theme[]> {
    return Array.from(memoryStore.themes.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async getById(id: string): Promise<Theme | null> {
    return memoryStore.themes.get(id) ?? null;
  }

  async assignToHackathon(hackathonId: string, themeId: string, organizerId: string): Promise<void> {
    const hackathon = memoryStore.hackathons.get(hackathonId);
    if (!hackathon) throw Object.assign(new Error('Hackathon not found'), { statusCode: 404 });
    if (hackathon.organizerId !== organizerId) {
      const user = memoryStore.users.get(organizerId);
      if (user?.role !== 'ADMIN') throw Object.assign(new Error('Not owner'), { statusCode: 403 });
    }
    const theme = memoryStore.themes.get(themeId);
    if (!theme) throw Object.assign(new Error('Theme not found'), { statusCode: 404 });
    if (!hackathon.themeIds.includes(themeId)) {
      hackathon.themeIds.push(themeId);
      hackathon.updatedAt = new Date().toISOString();
      hackathon.version += 1;
      memoryStore.hackathons.set(hackathonId, hackathon);
      await auditService.log({
        actorId: organizerId,
        actorRole: 'ORGANIZER',
        action: 'hackathon.theme_assigned',
        resourceType: 'hackathon',
        resourceId: hackathonId,
        outcome: 'success',
        metadata: { themeId, themeName: theme.name },
      });
    }
  }

  // Configurable themes - prevent hardcoding only these, but seed defaults if empty
  async seedDefaults(createdById: string) {
    const defaults = ['AI', 'FinTech', 'HealthTech', 'Climate', 'Education', 'Cybersecurity', 'Open Innovation'];
    for (const name of defaults) {
      const exists = Array.from(memoryStore.themes.values()).some((t) => t.name.toLowerCase() === name.toLowerCase());
      if (!exists) await this.create(name, createdById, `Default theme: ${name}`);
    }
  }
}

export const themesService = new ThemesService();
