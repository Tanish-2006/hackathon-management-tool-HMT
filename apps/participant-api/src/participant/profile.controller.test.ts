import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaService } from '../database/prisma.service';
import { ProfileController } from './profile.controller';

const neo4jStub = { write: async () => undefined };

describe('profile — account vs profile field routing', () => {
  let prisma: PrismaService;
  let controller: ProfileController;

  beforeEach(() => {
    prisma = new PrismaService();
    controller = new ProfileController(prisma, neo4jStub as any);
  });

  async function makeUser(email: string) {
    const u: any = await (prisma.user as any).create({
      data: { email, passwordHash: 'x', fullName: 'Old Name' },
    });
    return u.id as string;
  }

  function reqFor(userId: string) {
    return { user: { id: userId, role: 'PARTICIPANT' } };
  }

  it('fullName updates the user record while institution fields land on the profile', async () => {
    const uid = await makeUser('names@hmt.test');
    const updated: any = await controller.updateProfile(reqFor(uid) as any, {
      fullName: '  New Name  ',
      institution: 'NIT',
      city: 'Chennai',
      bio: 'builder',
    } as any);
    expect(updated.institution).toBe('NIT');
    expect(updated.city).toBe('Chennai');
    expect(updated.fullName).toBeUndefined();
    const user: any = await (prisma.user as any).findUnique({ where: { id: uid } });
    expect(user.fullName).toBe('New Name');
    // Refresh persistence: re-read returns the same values.
    const reread: any = await controller.getProfile(reqFor(uid) as any);
    expect(reread.institution).toBe('NIT');
  });

  it('email/phone cannot be changed through the profile endpoint', async () => {
    const uid = await makeUser('locked@hmt.test');
    const updated: any = await controller.updateProfile(reqFor(uid) as any, { bio: 'x', email: 'evil@h.t' } as any);
    const user: any = await (prisma.user as any).findUnique({ where: { id: uid } });
    expect(user.email).toBe('locked@hmt.test');
    expect(updated.email).toBeUndefined();
  });
});
