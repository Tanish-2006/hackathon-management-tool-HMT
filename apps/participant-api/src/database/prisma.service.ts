import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PgMapStore } from '@hmt/common';

/**
 * PrismaService — In-Memory Repository with optional Postgres delegation.
 * Extended to support full HMT Participant spec:
 * SkillProfile, EmailVerification, PasswordReset, DeviceSession, TeamInvitation, TeamInterest,
 * RepositoryAccessGrant, PhaseProgress, Mistake, ImprovementArea, Evaluation, ParticipantInsight,
 * ProjectMilestone, ProjectContinuation, Opportunity, RecommendedResource, RoadmapItem,
 * AIConversation, AIAnalysisJob, AIFinding, AIRecommendation etc.
 */
const APPEND_ONLY_COLLECTIONS = new Set(['aiMessages', 'auditLogs', 'aiInteractions']);

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  // In-memory stores
  private users = new Map<string, any>();
  private profiles = new Map<string, any>();
  private skillProfiles = new Map<string, any>(); // userId -> skillProfile
  private tokens = new Map<string, any>(); // tokenHash -> refreshToken
  private emailVerificationTokens = new Map<string, any>(); // tokenHash -> token
  private passwordResetTokens = new Map<string, any>();
  private phoneVerifications = new Map<string, any>(); // otpHash -> phone OTP record
  private deviceSessions = new Map<string, any>(); // sessionId -> session
  private hackathons = new Map<string, any>();
  private announcements = new Map<string, any>();
  private teams = new Map<string, any>();
  private members = new Map<string, any>(); // memberId -> member
  private teamInvitations = new Map<string, any>();
  private teamInterests = new Map<string, any>();
  private teamJoinRequests = new Map<string, any>(); // requestId -> join request
  private teamLeaveRequests = new Map<string, any>(); // requestId -> leave request
  private notifications = new Map<string, any>(); // notificationId -> notification
  private projects = new Map<string, any>(); // teamId -> project
  private projectsById = new Map<string, any>(); // projectId -> project
  private projectMilestones = new Map<string, any>();
  private scans = new Map<string, any>();
  private findings = new Map<string, any>();
  private feedbacks = new Map<string, any>();
  private eliminations = new Map<string, any>(); // projectId -> elim
  private _phaseProgressStore = new Map<string, any>();
  private mistakes = new Map<string, any>();
  private improvementAreas = new Map<string, any>();
  private evaluations = new Map<string, any>();
  private participantInsights = new Map<string, any>();
  private continuations = new Map<string, any>();
  private projectContinuations = new Map<string, any>();
  private projectOpportunities = new Map<string, any>();
  private recommendedResources = new Map<string, any>();
  private roadmapItems = new Map<string, any>();
  private repositoryGrants = new Map<string, any>();
  private githubConnections = new Map<string, any>(); // userId -> githubConnection
  private githubOAuthStates = new Map<string, any>(); // state -> {userId, expiresAt}
  private aiConversations = new Map<string, any>();
  private aiMessages = new Map<string, any>();
  private aiAnalysisJobs = new Map<string, any>();
  private aiFindings = new Map<string, any>();
  private aiRecommendations = new Map<string, any>();
  private aiInteractions = new Map<string, any>(); // persistent AI interaction log
  private auditLogs = new Map<string, any>();
  private registrations = new Map<string, any>(); // registrationId -> { id, hackathonId, userId, status, ... }
  private consumedEvents = new Map<string, any>(); // eventId -> { eventId, hackathonId, consumedAt }

  private stateStore: PgMapStore | null = null;

  async onModuleInit() {
    const url = process.env.DATABASE_URL;
    const persist = process.env.NODE_ENV === 'production' || process.env.PERSIST_STATE === 'true';
    if (!persist) {
      this.logger.log('PrismaService running in-memory (set PERSIST_STATE=true to persist to Postgres).');
      return;
    }
    if (!url) throw new Error('DATABASE_URL is required to persist participant state');
    const store = new PgMapStore(url, 'participant', 1000, (error) =>
      this.logger.error(`State flush failed: ${String(error)}`),
    );
    const maps = Object.entries(this).filter(
      (entry): entry is [string, Map<string, unknown>] => entry[1] instanceof Map,
    );
    for (const [name, map] of maps) await store.attachMap(name, map, { immutable: APPEND_ONLY_COLLECTIONS.has(name) });
    store.start();
    this.stateStore = store;
    this.logger.log(`PrismaService persisting ${maps.length} collections to Postgres`);
  }

  async onModuleDestroy() {
    await this.stateStore?.close();
  }

  // ---------- User ----------
  get user() {
    return {
      findUnique: async ({ where, select, include }: any) => {
        let found: any = null;
        if (where.email) {
          for (const u of this.users.values())
            if (u.email === where.email) found = u;
        } else if (where.phoneNumber) {
          for (const u of this.users.values()) if (u.phoneNumber === where.phoneNumber) found = u;
        } else if (where.id) found = this.users.get(where.id) || null;
        if (!found) return null;
        if (select) {
          const result: any = {};
          for (const key of Object.keys(select)) {
            if (select[key] === true) result[key] = found[key];
          }
          if (select.profile)
            result.profile = this.profiles.get(found.id) || null;
          if (select.skillProfile)
            result.skillProfile = this.skillProfiles.get(found.id) || null;
          if (select.teamMemberships) {
            const memberships = Array.from(this.members.values()).filter(
              (m) => m.userId === found.id,
            );
            result.teamMemberships = memberships.map((m: any) => {
              const team = this.teams.get(m.teamId);
              if (!team) return m;
              const project = this.projects.get(team.id) || null;
              const hackathon = team.hackathonId
                ? this.hackathons.get(team.hackathonId) || null
                : null;
              return {
                ...m,
                team: { ...team, project, hackathon, members: [m] },
              };
            });
          }
          return result;
        }
        if (include?.profile)
          return { ...found, profile: this.profiles.get(found.id) || null };
        if (include?.skillProfile)
          return {
            ...found,
            skillProfile: this.skillProfiles.get(found.id) || null,
          };
        return found;
      },
      findFirst: async () => Array.from(this.users.values())[0] || null,
      findMany: async ({ where }: any = {}) => {
        let arr = Array.from(this.users.values());
        if (where?.email) arr = arr.filter((u: any) => u.email === where.email);
        if (where?.phoneNumber) arr = arr.filter((u: any) => u.phoneNumber === where.phoneNumber);
        return arr;
      },
      create: async ({ data, include }: any) => {
        for (const u of this.users.values()) {
          const field =
            u.email === data.email ? 'email' : data.phoneNumber && u.phoneNumber === data.phoneNumber ? 'phoneNumber' : null;
          if (field) {
            throw Object.assign(new Error(`Unique constraint failed on ${field}`), { code: 'P2002' });
          }
        }
        const id =
          data.id ||
          `user_${randomUUID()}`;
        const record = {
          id,
          email: data.email,
          passwordHash: data.passwordHash,
          fullName: data.fullName,
          role: data.role || 'PARTICIPANT',
          isEmailVerified: false,
          phoneNumber: data.phoneNumber ?? null,
          isPhoneVerified: data.isPhoneVerified ?? false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.users.set(id, record);
        if (data.profile?.create) {
          const p = {
            id: `prof_${id}`,
            userId: id,
            bio: data.profile.create.bio ?? '',
            skills: data.profile.create.skills ?? [],
            githubUrl: data.profile.create.githubUrl ?? null,
            experience: data.profile.create.experience ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data.profile.create,
          };
          this.profiles.set(id, p);
        }
        if (include?.profile)
          return { ...record, profile: this.profiles.get(id) || null };
        return record;
      },
      update: async ({ where, data }: any) => {
        const found = this.users.get(where.id);
        if (!found) return null;
        if (data.phoneNumber && data.phoneNumber !== found.phoneNumber) {
          for (const u of this.users.values()) {
            if (u.id !== where.id && u.phoneNumber === data.phoneNumber) {
              throw Object.assign(new Error('Unique constraint failed on phoneNumber'), {
                code: 'P2002',
              });
            }
          }
        }
        const updated = { ...found, ...data, updatedAt: new Date() };
        this.users.set(where.id, updated);
        return updated;
      },
    };
  }

  // ---------- Profile ----------
  get profile() {
    return {
      findUnique: async ({ where, include }: any) => {
        const p = this.profiles.get(where.userId) || null;
        if (!p) return null;
        if (include?.user)
          return { ...p, user: this.users.get(where.userId) || null };
        return p;
      },
      findMany: async () => Array.from(this.profiles.values()),
      upsert: async ({ where, update, create }: any) => {
        const existing = this.profiles.get(where.userId);
        if (existing) {
          const updated = { ...existing, ...update, updatedAt: new Date() };
          if (updated.linkedinUrl) delete updated.linkedinUrl;
          this.profiles.set(where.userId, updated);
          return updated;
        }
        const created = {
          id: `prof_${where.userId}`,
          userId: where.userId,
          bio: create.bio ?? null,
          githubUrl: create.githubUrl ?? null,
          skills: create.skills ?? [],
          experience: create.experience ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...create,
        };
        if (created.linkedinUrl) delete created.linkedinUrl;
        this.profiles.set(where.userId, created);
        return created;
      },
      update: async ({ where, data }: any) => {
        const existing = this.profiles.get(where.userId);
        if (!existing) return null;
        const updated = { ...existing, ...data, updatedAt: new Date() };
        this.profiles.set(where.userId, updated);
        return updated;
      },
    };
  }

  // ---------- SkillProfile ----------
  get skillProfile() {
    return {
      findUnique: async ({ where }: any) => {
        if (where.userId) return this.skillProfiles.get(where.userId) || null;
        if (where.id) {
          for (const v of this.skillProfiles.values())
            if (v.id === where.id) return v;
          return null;
        }
        return null;
      },
      findMany: async ({ where }: any = {}) => {
        let arr = Array.from(this.skillProfiles.values());
        if (where?.visibility)
          arr = arr.filter((p: any) => p.visibility === where.visibility);
        return arr;
      },
      upsert: async ({ where, update, create }: any) => {
        const existing = this.skillProfiles.get(where.userId);
        if (existing) {
          const updated = { ...existing, ...update, updatedAt: new Date() };
          this.skillProfiles.set(where.userId, updated);
          return updated;
        }
        const created = {
          id: `skill_${where.userId}_${Date.now()}`,
          userId: where.userId,
          programmingLanguages: create.programmingLanguages ?? [],
          frameworks: create.frameworks ?? [],
          databases: create.databases ?? [],
          aiMl: create.aiMl ?? [],
          frontend: create.frontend ?? [],
          backend: create.backend ?? [],
          devOps: create.devOps ?? [],
          uiUx: create.uiUx ?? [],
          product: create.product ?? [],
          communication: create.communication ?? 3,
          leadership: create.leadership ?? 3,
          experienceLevel: create.experienceLevel ?? 'INTERMEDIATE',
          interests: create.interests ?? [],
          availability: create.availability ?? null,
          visibility: create.visibility ?? 'TEAM_DISCOVERABLE',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...create,
        };
        this.skillProfiles.set(where.userId, created);
        return created;
      },
      create: async ({ data }: any) => {
        const rec = {
          id: `skill_${data.userId}_${Date.now()}`,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.skillProfiles.set(data.userId, rec);
        return rec;
      },
      update: async ({ where, data }: any) => {
        const existing = this.skillProfiles.get(where.userId);
        if (!existing) return null;
        const updated = { ...existing, ...data, updatedAt: new Date() };
        this.skillProfiles.set(where.userId, updated);
        return updated;
      },
    };
  }

  // ---------- EmailVerificationToken ----------
  get emailVerificationToken() {
    return {
      create: async ({ data }: any) => {
        const id = `ev_${randomUUID()}`;
        const rec = { id, ...data, isUsed: false, createdAt: new Date() };
        this.emailVerificationTokens.set(data.tokenHash, rec);
        return rec;
      },
      findUnique: async ({ where }: any) => {
        if (where.tokenHash)
          return this.emailVerificationTokens.get(where.tokenHash) || null;
        for (const v of this.emailVerificationTokens.values())
          if (v.id === where.id) return v;
        return null;
      },
      findFirst: async ({ where }: any) => {
        for (const v of this.emailVerificationTokens.values()) {
          if (where.userId && v.userId !== where.userId) continue;
          if (where.isUsed !== undefined && v.isUsed !== where.isUsed) continue;
          return v;
        }
        return null;
      },
      update: async ({ where, data }: any) => {
        for (const [k, v] of this.emailVerificationTokens.entries()) {
          if (v.id === where.id || k === where.tokenHash) {
            const updated = { ...v, ...data };
            this.emailVerificationTokens.set(k, updated);
            return updated;
          }
        }
        return null;
      },
    };
  }

  // ---------- PasswordResetToken ----------
  get passwordResetToken() {
    return {
      create: async ({ data }: any) => {
        const id = `pr_${randomUUID()}`;
        const rec = { id, ...data, isUsed: false, createdAt: new Date() };
        this.passwordResetTokens.set(data.tokenHash, rec);
        return rec;
      },
      findUnique: async ({ where }: any) => {
        if (where.tokenHash)
          return this.passwordResetTokens.get(where.tokenHash) || null;
        for (const v of this.passwordResetTokens.values())
          if (v.id === where.id) return v;
        return null;
      },
      findFirst: async ({ where }: any) => {
        for (const v of this.passwordResetTokens.values()) {
          if (where.userId && v.userId !== where.userId) continue;
          return v;
        }
        return null;
      },
      update: async ({ where, data }: any) => {
        for (const [k, v] of this.passwordResetTokens.entries()) {
          if (v.id === where.id || k === where.tokenHash) {
            const updated = { ...v, ...data };
            this.passwordResetTokens.set(k, updated);
            return updated;
          }
        }
        return null;
      },
    };
  }

  // ---------- PhoneVerification (Phase 1 phone OTP) ----------
  get phoneVerification() {
    return {
      create: async ({ data }: any) => {
        const id = `pv_${randomUUID()}`;
        const rec = { id, attempts: 0, isUsed: false, createdAt: new Date(), ...data };
        this.phoneVerifications.set(data.otpHash, rec);
        return rec;
      },
      findUnique: async ({ where }: any) => {
        if (where.otpHash) return this.phoneVerifications.get(where.otpHash) || null;
        for (const v of this.phoneVerifications.values()) if (v.id === where.id) return v;
        return null;
      },
      findFirst: async ({ where, orderBy }: any = {}) => {
        let arr = Array.from(this.phoneVerifications.values());
        if (where?.phoneNumber) arr = arr.filter((v: any) => v.phoneNumber === where.phoneNumber);
        if (where?.userId) arr = arr.filter((v: any) => v.userId === where.userId);
        if (where?.isUsed !== undefined) arr = arr.filter((v: any) => v.isUsed === where.isUsed);
        if (orderBy?.createdAt === 'desc')
          arr = arr.sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime());
        return arr[0] || null;
      },
      findMany: async ({ where }: any = {}) => {
        let arr = Array.from(this.phoneVerifications.values());
        if (where?.phoneNumber) arr = arr.filter((v: any) => v.phoneNumber === where.phoneNumber);
        if (where?.userId) arr = arr.filter((v: any) => v.userId === where.userId);
        return arr;
      },
      update: async ({ where, data }: any) => {
        for (const [k, v] of this.phoneVerifications.entries()) {
          if (v.id === where.id || k === where.otpHash) {
            const updated = { ...v, ...data };
            this.phoneVerifications.set(k, updated);
            return updated;
          }
        }
        return null;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const [k, v] of this.phoneVerifications.entries()) {
          if (where?.phoneNumber && v.phoneNumber !== where.phoneNumber) continue;
          if (where?.userId && v.userId !== where.userId) continue;
          if (where?.isUsed !== undefined && v.isUsed !== where.isUsed) continue;
          this.phoneVerifications.set(k, { ...v, ...data });
          count++;
        }
        return { count };
      },
    };
  }

  // ---------- DeviceSession ----------
  get deviceSession() {
    return {
      create: async ({ data }: any) => {
        const id = `sess_${randomUUID()}`;
        const rec = {
          id,
          ...data,
          createdAt: new Date(),
          lastActive: new Date(),
          isRevoked: false,
        };
        this.deviceSessions.set(id, rec);
        return rec;
      },
      findMany: async ({ where }: any) => {
        let arr = Array.from(this.deviceSessions.values());
        if (where?.userId)
          arr = arr.filter((s: any) => s.userId === where.userId);
        if (where?.isRevoked !== undefined)
          arr = arr.filter((s: any) => s.isRevoked === where.isRevoked);
        return arr;
      },
      findFirst: async ({ where }: any) => {
        for (const v of this.deviceSessions.values()) {
          if (where.userId && v.userId !== where.userId) continue;
          if (where.familyId && v.familyId !== where.familyId) continue;
          return v;
        }
        return null;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const [k, v] of this.deviceSessions.entries()) {
          let match = true;
          if (where.familyId && v.familyId !== where.familyId) match = false;
          if (where.userId && v.userId !== where.userId) match = false;
          if (where.id && v.id !== where.id) match = false;
          if (match) {
            this.deviceSessions.set(k, { ...v, ...data });
            count++;
          }
        }
        return { count };
      },
    };
  }
  // alias for legacy session name
  get session() {
    return this.deviceSession;
  }

  // ---------- RefreshToken ----------
  get refreshToken() {
    return {
      create: async ({ data }: any) => {
        const id = `token_${randomUUID()}`;
        const record = { id, ...data, isRevoked: false, createdAt: new Date() };
        this.tokens.set(data.tokenHash, record);
        // also create device session if not exists
        const sessId = `sess_${id}`;
        if (
          !Array.from(this.deviceSessions.values()).some(
            (s: any) => s.familyId === data.familyId,
          )
        ) {
          this.deviceSessions.set(sessId, {
            id: sessId,
            userId: data.userId,
            familyId: data.familyId,
            deviceInfo: data.deviceInfo || 'unknown',
            ipAddress: data.ipAddress || null,
            createdAt: new Date(),
            lastActive: new Date(),
            isRevoked: false,
          });
        }
        return record;
      },
      findUnique: async ({ where, include }: any) => {
        const token = this.tokens.get(where.tokenHash);
        if (!token) return null;
        if (include?.user) {
          const u = this.users.get(token.userId);
          return { ...token, user: u };
        }
        return token;
      },
      findFirst: async ({ where }: any) => {
        for (const v of this.tokens.values()) {
          if (where.userId && v.userId !== where.userId) continue;
          if (where.familyId && v.familyId !== where.familyId) continue;
          return v;
        }
        return null;
      },
      findMany: async ({ where }: any) => {
        let arr = Array.from(this.tokens.values());
        if (where?.userId)
          arr = arr.filter((t: any) => t.userId === where.userId);
        if (where?.familyId)
          arr = arr.filter((t: any) => t.familyId === where.familyId);
        if (where?.isRevoked !== undefined)
          arr = arr.filter((t: any) => t.isRevoked === where.isRevoked);
        return arr;
      },
      update: async ({ where, data }: any) => {
        for (const [hash, t] of this.tokens.entries()) {
          if (t.id === where.id) {
            const updated = { ...t, ...data };
            this.tokens.set(hash, updated);
            return updated;
          }
        }
        return null;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const [hash, t] of this.tokens.entries()) {
          let match = false;
          if (where.familyId && t.familyId === where.familyId) match = true;
          if (where.userId && t.userId === where.userId) match = true;
          if (where.tokenHash && hash === where.tokenHash) match = true;
          if (where.id && t.id === where.id) match = true;
          // if where has multiple fields, treat as AND unless empty -> handled via match logic: we need AND semantics when multiple conditions present
          // simpler: if any specified condition fails, no match
          let should = true;
          if (where.familyId && t.familyId !== where.familyId) should = false;
          if (where.userId && t.userId !== where.userId) should = false;
          if (where.tokenHash && hash !== where.tokenHash) should = false;
          if (where.id && t.id !== where.id) should = false;
          // if only one condition, previous match logic suffices but we use should for strict AND when more than one
          const conditionCount = Object.keys(where).length;
          const isMatch = conditionCount === 1 ? match : should;
          // also handle empty where (update all) - not used
          if (isMatch) {
            this.tokens.set(hash, { ...t, ...data });
            count++;
          }
        }
        // also sync device sessions revocation
        if (data.isRevoked) {
          for (const [k, v] of this.deviceSessions.entries()) {
            let sessMatch = true;
            if (where.familyId && v.familyId !== where.familyId)
              sessMatch = false;
            if (where.userId && v.userId !== where.userId) sessMatch = false;
            if (sessMatch && (where.familyId || where.userId)) {
              this.deviceSessions.set(k, { ...v, isRevoked: true });
            }
          }
        }
        return { count };
      },
      deleteMany: async ({ where }: any) => {
        let count = 0;
        for (const [hash, t] of Array.from(this.tokens.entries())) {
          if (where.userId && t.userId === where.userId) {
            this.tokens.delete(hash);
            count++;
          }
        }
        return { count };
      },
    };
  }

  // ---------- Hackathon (canonical read-model) ----------
  // Same hackathonId/slug as organizer; status enum (not boolean) + discovery windows.
  // isPublished kept as derived compat (status !== DRAFT/REVIEW/CONFIRMED).
  get hackathon() {
    const applyWhere = (all: any[], where?: any) => {
      let filtered = all;
      if (!where) return filtered;
      if (where?.isPublished !== undefined)
        filtered = filtered.filter(
          (h: any) => h.isPublished === where.isPublished,
        );
      if (where?.status !== undefined) {
        if (typeof where.status === 'string')
          filtered = filtered.filter((h: any) => h.status === where.status);
        else if (where.status?.in)
          filtered = filtered.filter((h: any) =>
            where.status.in.includes(h.status),
          );
      }
      if (where?.mode !== undefined)
        filtered = filtered.filter((h: any) => h.mode === where.mode);
      if (where?.slug !== undefined)
        filtered = filtered.filter((h: any) => h.slug === where.slug);
      if (where?.id !== undefined && typeof where.id === 'string')
        filtered = filtered.filter((h: any) => h.id === where.id);
      return filtered;
    };
    return {
      findFirst: async (args?: any) => {
        const all = Array.from(this.hackathons.values());
        if (all.length === 0) return null;
        let filtered = applyWhere(all, args?.where);
        if (filtered.length === 0) return null;
        if (args?.orderBy?.createdAt === 'desc') {
          return filtered.sort(
            (a: any, b: any) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )[0];
        }
        return filtered[0];
      },
      findMany: async (args?: any) => {
        let all = Array.from(this.hackathons.values());
        all = applyWhere(all, args?.where);
        if (args?.orderBy?.createdAt === 'desc') {
          all = [...all].sort(
            (a: any, b: any) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          );
        }
        // Pagination support (skip/take) for discovery.
        if (typeof args?.skip === 'number') all = all.slice(args.skip);
        if (typeof args?.take === 'number') all = all.slice(0, args.take);
        if (args?.include?.announcements) {
          return all.map((h: any) => ({
            ...h,
            announcements: Array.from(this.announcements.values()).filter(
              (a: any) => a.hackathonId === h.id && a.isPublished,
            ),
          }));
        }
        return all;
      },
      findUnique: async ({ where, include }: any) => {
        let h: any = null;
        if (where?.id) h = this.hackathons.get(where.id) || null;
        if (!h && where?.slug) {
          for (const v of this.hackathons.values())
            if (v.slug === where.slug) h = v;
        }
        if (!h) return null;
        if (include?.announcements) {
          const anns = Array.from(this.announcements.values()).filter(
            (a: any) => a.hackathonId === h.id && a.isPublished,
          );
          return { ...h, announcements: anns };
        }
        return h;
      },
      create: async ({ data, include }: any) => {
        const id =
          data.id ||
          data.hackathonId ||
          `hack_${randomUUID()}`;
        const status = data.status ?? (data.isPublished === false ? 'DRAFT' : 'PUBLISHED');
        const record = {
          ...data,
          id,
          slug: data.slug ?? id,
          title: data.title,
          description: data.description,
          mode: data.mode ?? 'ONLINE',
          status,
          isPublished: status === 'PUBLISHED' || status === 'ARCHIVED' ? true : (data.isPublished ?? true),
          hackathonType: data.hackathonType ?? 'OPEN_INNOVATION',
          organizer: data.organizer ?? data.organizerName ?? null,
          organizerName: data.organizerName ?? data.organizer ?? null,
          problemStatement: data.problemStatement,
          rules: data.rules ?? [],
          resources: data.resources ?? [],
          judgingCriteria: data.judgingCriteria ?? [],
          phases: data.phases ?? [],
          themes: data.themes ?? (data.theme ? [data.theme] : []),
          category: data.category ?? (data.theme ?? null),
          tags: data.tags ?? [],
          eligibility: data.eligibility ?? [],
          teamSize: data.teamSize ?? null,
          registrationStart: data.registrationStart ?? null,
          registrationEnd: data.registrationEnd ?? null,
          eventStart: data.eventStart ?? data.startDate ?? null,
          eventEnd: data.eventEnd ?? data.endDate ?? null,
          startDate: data.startDate ?? data.eventStart ?? new Date(),
          endDate: data.endDate ?? data.eventEnd ?? new Date(Date.now() + 86400000 * 3),
          publishedAt: data.publishedAt ?? new Date(),
          announcements: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.hackathons.set(id, record);
        // handle nested announcements create
        if (data.announcements?.create) {
          const anns = Array.isArray(data.announcements.create)
            ? data.announcements.create
            : [data.announcements.create];
          for (const a of anns) {
            const annId = `ann_${randomUUID()}`;
            this.announcements.set(annId, {
              id: annId,
              hackathonId: id,
              ...a,
              isPublished: a.isPublished ?? true,
              visibility: a.visibility ?? 'PUBLIC_PROFILE',
              createdAt: new Date(),
            });
          }
        }
        if (include?.announcements) {
          const anns = Array.from(this.announcements.values()).filter(
            (a: any) => a.hackathonId === id,
          );
          return { ...record, announcements: anns };
        }
        return record;
      },
      update: async ({ where, data }: any) => {
        const h = this.hackathons.get(where.id);
        if (!h) return null;
        const updated = { ...h, ...data, updatedAt: new Date() };
        if (data.status && updated.isPublished === undefined) {
          updated.isPublished = ['PUBLISHED', 'ARCHIVED'].includes(data.status);
        }
        this.hackathons.set(where.id, updated);
        return updated;
      },
      // Idempotent upsert by canonical hackathonId/slug (organizer → participant sync).
      upsert: async ({ where, update, create }: any) => {
        const id = where?.id ?? create?.id ?? create?.hackathonId;
        const existing = id ? this.hackathons.get(id) : null;
        if (existing) {
          const updated = { ...existing, ...update, updatedAt: new Date() };
          this.hackathons.set(id, updated);
          return updated;
        }
        // delegate to create
        return (this as any).hackathon.create({ data: create });
      },
    };
  }

  // ---------- Hackathon registrations (Discover → Details → Register) ----------
  get registration() {
    return {
      findMany: async ({ where }: any = {}) => {
        let arr = Array.from(this.registrations.values());
        if (where?.userId) arr = arr.filter((r: any) => r.userId === where.userId);
        if (where?.hackathonId) arr = arr.filter((r: any) => r.hackathonId === where.hackathonId);
        if (where?.status) arr = arr.filter((r: any) => r.status === where.status);
        return arr;
      },
      findFirst: async ({ where }: any = {}) => {
        for (const r of this.registrations.values()) {
          if (where?.userId && r.userId !== where.userId) continue;
          if (where?.hackathonId && r.hackathonId !== where.hackathonId) continue;
          return r;
        }
        return null;
      },
      create: async ({ data }: any) => {
        for (const r of this.registrations.values()) {
          if (r.userId === data.userId && r.hackathonId === data.hackathonId) {
            throw Object.assign(new Error('Unique constraint failed on (userId, hackathonId)'), { code: 'P2002' });
          }
        }
        const id = data.id ?? `reg_${randomUUID()}`;
        const record = {
          status: 'REGISTERED',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
          id,
        };
        this.registrations.set(id, record);
        return record;
      },
    };
  }

  get consumedEvent() {
    return {
      findUnique: async ({ where }: any) => this.consumedEvents.get(where.eventId) || null,
      create: async ({ data }: any) => {
        this.consumedEvents.set(data.eventId, { ...data, consumedAt: new Date() });
        return data;
      },
    };
  }

  get announcement() {
    return {
      create: async ({ data }: any) => {
        const id = `ann_${randomUUID()}`;
        const rec = {
          id,
          ...data,
          isPublished: data.isPublished ?? true,
          visibility: data.visibility ?? 'PUBLIC_PROFILE',
          createdAt: new Date(),
        };
        this.announcements.set(id, rec);
        return rec;
      },
      findMany: async ({ where }: any = {}) => {
        let arr = Array.from(this.announcements.values());
        if (where?.hackathonId)
          arr = arr.filter((a: any) => a.hackathonId === where.hackathonId);
        if (where?.isPublished !== undefined)
          arr = arr.filter((a: any) => a.isPublished === where.isPublished);
        // only published visible to participants
        return arr;
      },
      findUnique: async ({ where }: any) =>
        this.announcements.get(where.id) || null,
    };
  }

  // ---------- TeamMember ----------
  get teamMember() {
    return {
      findFirst: async ({ where, include }: any) => {
        for (const m of this.members.values()) {
          const matchUser = where.userId ? m.userId === where.userId : true;
          const matchTeam = where.teamId ? m.teamId === where.teamId : true;
          if (matchUser && matchTeam) {
            if (include?.team) {
              const team = this.teams.get(m.teamId);
              if (!team) return { ...m, team: null };
              const project = this.projects.get(team.id) || null;
              const projectWithRelations = project
                ? {
                    ...project,
                    scans: Array.from(this.scans.values())
                      .filter((s: any) => s.projectId === project.id)
                      .map((s: any) => ({
                        ...s,
                        findings: Array.from(this.findings.values()).filter(
                          (f: any) => f.scanId === s.id,
                        ),
                      }))
                      .sort(
                        (a: any, b: any) =>
                          b.createdAt.getTime() - a.createdAt.getTime(),
                      ),
                    feedbacks: Array.from(this.feedbacks.values()).filter(
                      (f: any) => f.projectId === project.id,
                    ),
                    milestones: Array.from(
                      this.projectMilestones.values(),
                    ).filter((mm: any) => mm.projectId === project.id),
                  }
                : null;
              const hackathon = team.hackathonId
                ? this.hackathons.get(team.hackathonId) || null
                : null;
              const members = Array.from(this.members.values())
                .filter((x: any) => x.teamId === team.id)
                .map((x: any) => ({
                  ...x,
                  user: this.users.get(x.userId)
                    ? {
                        id: x.userId,
                        fullName: this.users.get(x.userId).fullName,
                        email: this.users.get(x.userId).email,
                        role: this.users.get(x.userId).role,
                      }
                    : null,
                }));
              // include team invitations/interests if requested
              const extra: any = {};
              if (include.team.include?.invitations)
                extra.invitations = Array.from(
                  this.teamInvitations.values(),
                ).filter((inv: any) => inv.teamId === team.id);
              if (include.team.include?.interests)
                extra.interests = Array.from(
                  this.teamInterests.values(),
                ).filter((int: any) => int.teamId === team.id);
              return {
                ...m,
                team: {
                  ...team,
                  project: projectWithRelations,
                  hackathon,
                  members,
                  ...extra,
                },
              };
            }
            if (include?.user) {
              return { ...m, user: this.users.get(m.userId) || null };
            }
            return m;
          }
        }
        return null;
      },
      findMany: async ({ where, include }: any = {}) => {
        let arr = Array.from(this.members.values()).filter((m: any) => {
          if (where?.teamId && m.teamId !== where.teamId) return false;
          if (where?.userId && m.userId !== where.userId) return false;
          return true;
        });
        if (include?.user)
          arr = arr.map((m: any) => ({
            ...m,
            user: this.users.get(m.userId) || null,
          }));
        if (include?.team)
          arr = arr.map((m: any) => {
            const team = this.teams.get(m.teamId);
            return { ...m, team: team ? { ...team } : null };
          });
        return arr;
      },
      create: async ({ data }: any) => {
        const id = `mem_${randomUUID()}`;
        const rec = { id, ...data, joinedAt: new Date() };
        this.members.set(id, rec);
        return rec;
      },
      update: async ({ where, data }: any) => {
        for (const [k, v] of this.members.entries()) {
          if (where.id && v.id === where.id) {
            const updated = { ...v, ...data };
            this.members.set(k, updated);
            return updated;
          }
        }
        return null;
      },
      delete: async ({ where }: any) => {
        for (const [k, v] of this.members.entries()) {
          if (where.id && v.id === where.id) {
            this.members.delete(k);
            return v;
          }
          if (
            where.teamId &&
            where.userId &&
            v.teamId === where.teamId &&
            v.userId === where.userId
          ) {
            this.members.delete(k);
            return v;
          }
        }
        return null;
      },
      deleteMany: async ({ where }: any) => {
        let count = 0;
        for (const [k, v] of Array.from(this.members.entries())) {
          let match = true;
          if (where.teamId && v.teamId !== where.teamId) match = false;
          if (where.userId && v.userId !== where.userId) match = false;
          if (match) {
            this.members.delete(k);
            count++;
          }
        }
        return { count };
      },
    };
  }

  // ---------- Team ----------
  get team() {
    return {
      create: async ({ data, include }: any) => {
        const id = `team_${randomUUID()}`;
        const record: any = {
          id,
          name: data.name,
          hackathonId: data.hackathonId,
          inviteCode: `invite_${Math.random().toString(36).slice(2, 8)}`,
          visibility: data.visibility ?? 'TEAM_DISCOVERABLE',
          maxMembers: data.maxMembers ?? 4,
          requirements: data.requirements ?? [],
          requiredSkills: data.requiredSkills ?? [],
          isDiscoverable: data.isDiscoverable ?? true,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        // ensure id override not duplicated
        record.id = id;
        this.teams.set(id, record);
        if (data.members?.create) {
          const creations = Array.isArray(data.members.create)
            ? data.members.create
            : [data.members.create];
          for (const c of creations) {
            const mId = `mem_${randomUUID()}`;
            const member = {
              id: mId,
              teamId: id,
              userId: c.userId,
              role: c.role || 'LEADER',
              joinedAt: new Date(),
            };
            this.members.set(mId, member);
          }
        }
        if (include?.members) {
          const members = Array.from(this.members.values()).filter(
            (m: any) => m.teamId === id,
          );
          return { ...record, members };
        }
        return {
          ...record,
          members: Array.from(this.members.values()).filter(
            (m: any) => m.teamId === id,
          ),
        };
      },
      findUnique: async ({ where, include }: any) => {
        const t =
          this.teams.get(where.id) ||
          (where.inviteCode
            ? Array.from(this.teams.values()).find(
                (tm: any) => tm.inviteCode === where.inviteCode,
              )
            : null) ||
          null;
        if (!t) return null;
        const result: any = { ...t };
        if (include?.members) {
          const members = Array.from(this.members.values())
            .filter((m: any) => m.teamId === t.id)
            .map((m: any) => ({
              ...m,
              user: this.users.get(m.userId)
                ? {
                    id: m.userId,
                    fullName: this.users.get(m.userId).fullName,
                    email: this.users.get(m.userId).email,
                  }
                : null,
            }));
          result.members = members;
        }
        if (include?.project) {
          const project = this.projects.get(t.id) || null;
          result.project =
            project && include.project.include?.milestones
              ? {
                  ...project,
                  milestones: Array.from(this.projectMilestones.values()).filter(
                    (mm: any) => mm.projectId === project.id,
                  ),
                }
              : project;
        }
        if (include?.hackathon)
          result.hackathon = this.hackathons.get(t.hackathonId) || null;
        return result;
      },
      findMany: async ({ where, include, skip, take }: any = {}) => {
        let arr = Array.from(this.teams.values());
        if (where?.hackathonId)
          arr = arr.filter((t: any) => t.hackathonId === where.hackathonId);
        if (where?.isDiscoverable !== undefined)
          arr = arr.filter(
            (t: any) => t.isDiscoverable === where.isDiscoverable,
          );
        if (where?.visibility) {
          if (where.visibility?.in)
            arr = arr.filter((t: any) =>
              where.visibility.in.includes(t.visibility),
            );
          else arr = arr.filter((t: any) => t.visibility === where.visibility);
        }
        if (where?.name?.contains) {
          const q = where.name.contains.toLowerCase();
          arr = arr.filter((t: any) => t.name.toLowerCase().includes(q));
        }
        if (skip) arr = arr.slice(skip);
        if (take) arr = arr.slice(0, take);
        if (include?.members) {
          arr = arr.map((t: any) => {
            const members = Array.from(this.members.values()).filter(
              (m: any) => m.teamId === t.id,
            );
            return { ...t, members };
          });
        }
        return arr;
      },
      findFirst: async ({ where }: any) => {
        for (const t of this.teams.values()) {
          if (where.hackathonId && t.hackathonId !== where.hackathonId)
            continue;
          if (where.name && t.name !== where.name) continue;
          return t;
        }
        return null;
      },
      update: async ({ where, data }: any) => {
        const t = this.teams.get(where.id);
        if (!t) return null;
        const updated = { ...t, ...data, updatedAt: new Date() };
        this.teams.set(where.id, updated);
        return updated;
      },
      delete: async ({ where }: any) => {
        const t = this.teams.get(where.id);
        if (t) this.teams.delete(where.id);
        return t;
      },
    };
  }

  // ---------- TeamInvitation ----------
  get teamInvitation() {
    return {
      create: async ({ data }: any) => {
        const id = `inv_${randomUUID()}`;
        const rec = {
          id,
          ...data,
          status: data.status ?? 'PENDING',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.teamInvitations.set(id, rec);
        return rec;
      },
      findMany: async ({ where }: any = {}) => {
        let arr = Array.from(this.teamInvitations.values());
        if (where?.teamId)
          arr = arr.filter((i: any) => i.teamId === where.teamId);
        if (where?.inviteeEmail)
          arr = arr.filter((i: any) => i.inviteeEmail === where.inviteeEmail);
        if (where?.inviteeId)
          arr = arr.filter((i: any) => i.inviteeId === where.inviteeId);
        if (where?.status)
          arr = arr.filter((i: any) => i.status === where.status);
        if (where?.id) arr = arr.filter((i: any) => i.id === where.id);
        return arr;
      },
      findUnique: async ({ where }: any) =>
        this.teamInvitations.get(where.id) || null,
      findFirst: async ({ where }: any) => {
        for (const v of this.teamInvitations.values()) {
          let match = true;
          if (where.teamId && v.teamId !== where.teamId) match = false;
          if (where.inviteeEmail && v.inviteeEmail !== where.inviteeEmail)
            match = false;
          if (where.inviteeId && v.inviteeId !== where.inviteeId) match = false;
          if (where.status && v.status !== where.status) match = false;
          if (where.id && v.id !== where.id) match = false;
          if (match) return v;
        }
        return null;
      },
      update: async ({ where, data }: any) => {
        const rec = this.teamInvitations.get(where.id);
        if (!rec) return null;
        const updated = { ...rec, ...data, updatedAt: new Date() };
        this.teamInvitations.set(where.id, updated);
        return updated;
      },
      delete: async ({ where }: any) => {
        const rec = this.teamInvitations.get(where.id);
        if (rec) this.teamInvitations.delete(where.id);
        return rec;
      },
    };
  }

  // ---------- TeamInterest ----------
  get teamInterest() {    return {
      create: async ({ data }: any) => {
        const id = `interest_${randomUUID()}`;
        const rec = { id, ...data, createdAt: new Date() };
        this.teamInterests.set(id, rec);
        return rec;
      },
      findMany: async ({ where }: any = {}) => {
        let arr = Array.from(this.teamInterests.values());
        if (where?.teamId)
          arr = arr.filter((i: any) => i.teamId === where.teamId);
        if (where?.userId)
          arr = arr.filter((i: any) => i.userId === where.userId);
        return arr;
      },
      findFirst: async ({ where }: any) => {
        for (const v of this.teamInterests.values()) {
          if (where.teamId && v.teamId !== where.teamId) continue;
          if (where.userId && v.userId !== where.userId) continue;
          return v;
        }
        return null;
      },
      delete: async ({ where }: any) => {
        for (const [k, v] of this.teamInterests.entries()) {
          if (where.id && v.id === where.id) {
            this.teamInterests.delete(k);
            return v;
          }
          if (
            where.teamId &&
            where.userId &&
            v.teamId === where.teamId &&
            v.userId === where.userId
          ) {
            this.teamInterests.delete(k);
            return v;
          }
        }
        return null;
      },
    };
  }

  // ---------- TeamJoinRequest (participant → team requests, leader-approved) ----------
  // Statuses: PENDING, APPROVED, REJECTED. Skill answers ride on the record
  // and are only ever returned by the leader-only list endpoint.
  get teamJoinRequest() {
    return {
      create: async ({ data }: any) => {
        const id = `req_${randomUUID()}`;
        const rec = {
          id,
          ...data,
          status: data.status ?? 'PENDING',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.teamJoinRequests.set(id, rec);
        return rec;
      },
      findUnique: async ({ where }: any) =>
        this.teamJoinRequests.get(where.id) || null,
      findFirst: async ({ where }: any = {}) => {
        for (const v of this.teamJoinRequests.values()) {
          let match = true;
          if (where.id && v.id !== where.id) match = false;
          if (where.teamId && v.teamId !== where.teamId) match = false;
          if (where.userId && v.userId !== where.userId) match = false;
          if (where.status && v.status !== where.status) match = false;
          if (where.hackathonId && v.hackathonId !== where.hackathonId) match = false;
          if (match) return v;
        }
        return null;
      },
      findMany: async ({ where }: any = {}) => {
        let arr = Array.from(this.teamJoinRequests.values());
        if (where?.teamId) arr = arr.filter((r: any) => r.teamId === where.teamId);
        if (where?.userId) arr = arr.filter((r: any) => r.userId === where.userId);
        if (where?.status) arr = arr.filter((r: any) => r.status === where.status);
        if (where?.hackathonId) arr = arr.filter((r: any) => r.hackathonId === where.hackathonId);
        return arr;
      },
      update: async ({ where, data }: any) => {
        const rec = this.teamJoinRequests.get(where.id);
        if (!rec) return null;
        const updated = { ...rec, ...data, updatedAt: new Date() };
        this.teamJoinRequests.set(where.id, updated);
        return updated;
      },
      deleteMany: async (args: any = {}) => {
        const where = args?.where ?? args ?? {};
        let count = 0;
        for (const [k, v] of Array.from(this.teamJoinRequests.entries())) {
          let match = true;
          if (where.teamId && v.teamId !== where.teamId) match = false;
          if (where.userId && v.userId !== where.userId) match = false;
          if (match) {
            this.teamJoinRequests.delete(k);
            count++;
          }
        }
        return { count };
      },
    };
  }

  // ---------- TeamLeaveRequest (member → leader: leaving needs approval) ----------
  // Same lifecycle shape as join requests. Membership is NOT removed on
  // creation — only the leader's accept removes it.
  get teamLeaveRequest() {
    return {
      create: async ({ data }: any) => {
        const id = `lvr_${randomUUID()}`;
        const rec = {
          id,
          ...data,
          status: data.status ?? 'PENDING',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.teamLeaveRequests.set(id, rec);
        return rec;
      },
      findUnique: async ({ where }: any) =>
        this.teamLeaveRequests.get(where.id) || null,
      findFirst: async ({ where }: any = {}) => {
        for (const v of this.teamLeaveRequests.values()) {
          let match = true;
          if (where.id && v.id !== where.id) match = false;
          if (where.teamId && v.teamId !== where.teamId) match = false;
          if (where.userId && v.userId !== where.userId) match = false;
          if (where.status && v.status !== where.status) match = false;
          if (where.hackathonId && v.hackathonId !== where.hackathonId) match = false;
          if (match) return v;
        }
        return null;
      },
      findMany: async ({ where }: any = {}) => {
        let arr = Array.from(this.teamLeaveRequests.values());
        if (where?.teamId) arr = arr.filter((r: any) => r.teamId === where.teamId);
        if (where?.userId) arr = arr.filter((r: any) => r.userId === where.userId);
        if (where?.status) arr = arr.filter((r: any) => r.status === where.status);
        if (where?.hackathonId) arr = arr.filter((r: any) => r.hackathonId === where.hackathonId);
        return arr;
      },
      update: async ({ where, data }: any) => {
        const rec = this.teamLeaveRequests.get(where.id);
        if (!rec) return null;
        const updated = { ...rec, ...data, updatedAt: new Date() };
        this.teamLeaveRequests.set(where.id, updated);
        return updated;
      },
      deleteMany: async (args: any = {}) => {
        const where = args?.where ?? args ?? {};
        let count = 0;
        for (const [k, v] of Array.from(this.teamLeaveRequests.entries())) {
          let match = true;
          if (where.teamId && v.teamId !== where.teamId) match = false;
          if (where.userId && v.userId !== where.userId) match = false;
          if (match) {
            this.teamLeaveRequests.delete(k);
            count++;
          }
        }
        return { count };
      },
    };
  }

  // ---------- Notification (persisted user inbox; drives the bell icon) ----------
  // Types: JOIN_REQUESTED, JOIN_APPROVED, JOIN_REJECTED, LEAVE_REQUESTED,
  // LEAVE_APPROVED, LEAVE_REJECTED. Callers dedupe on (userId, type,
  // requestId) so retries never produce duplicate inbox rows.
  get notification() {
    return {
      create: async ({ data }: any) => {
        const id = `ntf_${randomUUID()}`;
        const rec = {
          id,
          ...data,
          read: data.read ?? false,
          createdAt: new Date(),
          readAt: null,
        };
        this.notifications.set(id, rec);
        return rec;
      },
      findUnique: async ({ where }: any) =>
        this.notifications.get(where.id) || null,
      findFirst: async ({ where }: any = {}) => {
        for (const v of this.notifications.values()) {
          let match = true;
          if (where.id && v.id !== where.id) match = false;
          if (where.userId && v.userId !== where.userId) match = false;
          if (where.type && v.type !== where.type) match = false;
          if (where.requestId && v.requestId !== where.requestId) match = false;
          if (where.read !== undefined && v.read !== where.read) match = false;
          if (match) return v;
        }
        return null;
      },
      findMany: async ({ where }: any = {}) => {
        let arr = Array.from(this.notifications.values());
        if (where?.userId) arr = arr.filter((n: any) => n.userId === where.userId);
        if (where?.type) arr = arr.filter((n: any) => n.type === where.type);
        if (where?.read !== undefined) arr = arr.filter((n: any) => n.read === where.read);
        arr.sort((a: any, b: any) => +new Date(b.createdAt) - +new Date(a.createdAt));
        return arr;
      },
      update: async ({ where, data }: any) => {
        const rec = this.notifications.get(where.id);
        if (!rec) return null;
        const updated = { ...rec, ...data };
        this.notifications.set(where.id, updated);
        return updated;
      },
    };
  }

  // ---------- Project ----------
  get project() {
    return {
      upsert: async ({ where, update, create }: any) => {
        const existing = this.projects.get(where.teamId);
        if (existing) {
          const updated = { ...existing, ...update, updatedAt: new Date() };
          this.projects.set(where.teamId, updated);
          this.projectsById.set(updated.id, updated);
          return updated;
        }
        const created = {
          id: `proj_${where.teamId}_${Date.now()}`,
          teamId: where.teamId,
          title: create.title,
          description: create.description,
          techStack: create.techStack ?? [],
          repoUrl: create.repoUrl ?? null,
          status: create.status ?? 'ACTIVE',
          visibility: create.visibility ?? 'TEAM_PRIVATE',
          hackathonId: create.hackathonId ?? null,
          feedbacks: [],
          scans: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          ...create,
        };
        this.projects.set(where.teamId, created);
        this.projectsById.set(created.id, created);
        return created;
      },
      create: async ({ data }: any) => {
        const id =
          data.id ||
          `proj_${randomUUID()}`;
        const rec = {
          id,
          ...data,
          status: data.status ?? 'ACTIVE',
          visibility: data.visibility ?? 'TEAM_PRIVATE',
          techStack: data.techStack ?? [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        // need teamId mapping
        if (data.teamId) {
          this.projects.set(data.teamId, rec);
        }
        this.projectsById.set(id, rec);
        return rec;
      },
      findUnique: async ({ where, include }: any) => {
        let proj: any = null;
        if (where.teamId) proj = this.projects.get(where.teamId) || null;
        else if (where.id) proj = this.projectsById.get(where.id) || null;
        if (!proj) return null;
        if (include) {
          const result: any = { ...proj };
          if (include.milestones)
            result.milestones = Array.from(
              this.projectMilestones.values(),
            ).filter((m: any) => m.projectId === proj.id);
          if (include.scans)
            result.scans = Array.from(this.scans.values()).filter(
              (s: any) => s.projectId === proj.id,
            );
          if (include.feedbacks)
            result.feedbacks = Array.from(this.feedbacks.values()).filter(
              (f: any) => f.projectId === proj.id,
            );
          if (include.team) result.team = this.teams.get(proj.teamId) || null;
          if (include.repositoryGrants)
            result.repositoryGrants = Array.from(
              this.repositoryGrants.values(),
            ).filter((g: any) => g.projectId === proj.id);
          return result;
        }
        return proj;
      },
      findMany: async ({ where }: any = {}) => {
        let arr = Array.from(this.projectsById.values());
        if (where?.teamId)
          arr = arr.filter((p: any) => p.teamId === where.teamId);
        if (where?.hackathonId)
          arr = arr.filter((p: any) => p.hackathonId === where.hackathonId);
        return arr;
      },
      findFirst: async ({ where }: any) => {
        for (const p of this.projectsById.values()) {
          if (where.teamId && p.teamId !== where.teamId) continue;
          if (where.id && p.id !== where.id) continue;
          return p;
        }
        return null;
      },
      update: async ({ where, data }: any) => {
        let proj: any = null;
        let key: any = null;
        if (where.id) {
          proj = this.projectsById.get(where.id);
          key = proj?.teamId;
        } else if (where.teamId) {
          proj = this.projects.get(where.teamId);
          key = where.teamId;
        }
        if (!proj) return null;
        const updated = { ...proj, ...data, updatedAt: new Date() };
        this.projectsById.set(updated.id, updated);
        if (key) this.projects.set(key, updated);
        else if (updated.teamId) this.projects.set(updated.teamId, updated);
        return updated;
      },
    };
  }

  get projectMilestone() {
    return {
      create: async ({ data }: any) => {
        const id = `mile_${randomUUID()}`;
        const rec = {
          id,
          ...data,
          isCompleted: data.isCompleted ?? false,
          createdAt: new Date(),
        };
        this.projectMilestones.set(id, rec);
        return rec;
      },
      findMany: async ({ where, orderBy }: any = {}) => {
        let arr = Array.from(this.projectMilestones.values());
        if (where?.projectId)
          arr = arr.filter((m: any) => m.projectId === where.projectId);
        if (orderBy?.createdAt === 'desc')
          arr = arr.sort(
            (a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
        return arr;
      },
      findUnique: async ({ where }: any) =>
        this.projectMilestones.get(where.id) || null,
      update: async ({ where, data }: any) => {
        const rec = this.projectMilestones.get(where.id);
        if (!rec) return null;
        const updated = { ...rec, ...data };
        this.projectMilestones.set(where.id, updated);
        return updated;
      },
      delete: async ({ where }: any) => {
        const rec = this.projectMilestones.get(where.id);
        if (rec) this.projectMilestones.delete(where.id);
        return rec;
      },
    };
  }

  // ---------- RepositoryScan ----------
  get repositoryScan() {
    return {
      create: async ({ data }: any) => {
        const id = `scan_${randomUUID()}`;
        const scan = {
          id,
          ...data,
          score: data.score ?? null,
          commitHash: data.commitHash ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.scans.set(id, scan);
        return scan;
      },
      update: async ({ where, data }: any) => {
        const scan = this.scans.get(where.id);
        if (!scan) return null;
        const updated = { ...scan, ...data, updatedAt: new Date() };
        if (data.findings?.create) {
          for (const f of data.findings.create) {
            const fId = `find_${randomUUID()}`;
            this.findings.set(fId, {
              id: fId,
              scanId: where.id,
              ...f,
              createdAt: new Date(),
            });
          }
        }
        this.scans.set(where.id, updated);
        return updated;
      },
      findUnique: async ({ where, include }: any) => {
        const scan = this.scans.get(where.id);
        if (!scan) return null;
        if (include?.findings) {
          const findings = Array.from(this.findings.values()).filter(
            (f: any) => f.scanId === where.id,
          );
          return { ...scan, findings };
        }
        return scan;
      },
      findFirst: async ({ where, include, orderBy }: any) => {
        let candidates = Array.from(this.scans.values()).filter((s: any) => {
          if (where?.projectId && s.projectId !== where.projectId) return false;
          if (where?.status && s.status !== where.status) return false;
          return true;
        });
        if (orderBy?.createdAt === 'desc')
          candidates = candidates.sort(
            (a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
        else if (orderBy?.createdAt === 'asc')
          candidates = candidates.sort(
            (a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime(),
          );
        const scan = candidates[0] || null;
        if (!scan) return null;
        if (include?.findings) {
          const findings = Array.from(this.findings.values()).filter(
            (f: any) => f.scanId === scan.id,
          );
          return { ...scan, findings };
        }
        return scan;
      },
      findMany: async ({ where, include, orderBy }: any) => {
        let results = Array.from(this.scans.values()).filter(
          (s: any) => s.projectId === where.projectId,
        );
        if (orderBy?.createdAt === 'desc')
          results = results.sort(
            (a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
        if (include?.findings) {
          return results.map((s: any) => ({
            ...s,
            findings: Array.from(this.findings.values()).filter(
              (f: any) => f.scanId === s.id,
            ),
          }));
        }
        return results;
      },
    };
  }

  get scanFinding() {
    return {
      create: async ({ data }: any) => {
        const id = `find_${randomUUID()}`;
        const rec = { id, ...data, createdAt: new Date() };
        this.findings.set(id, rec);
        return rec;
      },
      findMany: async ({ where }: any = {}) => {
        let arr = Array.from(this.findings.values());
        if (where?.scanId)
          arr = arr.filter((f: any) => f.scanId === where.scanId);
        return arr;
      },
    };
  }

  // ---------- RepositoryAccessGrant ----------
  get repositoryAccessGrant() {
    return {
      create: async ({ data }: any) => {
        const id = `grant_${randomUUID()}`;
        const rec = {
          id,
          ...data,
          status: data.status ?? 'GRANTED',
          grantedAt: new Date(),
          revokedAt: null,
          createdAt: new Date(),
        };
        this.repositoryGrants.set(id, rec);
        // audit
        const auditId = `audit_${randomUUID()}`;
        this.auditLogs.set(auditId, {
          id: auditId,
          userId: data.grantedById,
          action: 'GRANT',
          resource: `repository:${data.projectId}`,
          details: rec,
          createdAt: new Date(),
        });
        return rec;
      },
      findMany: async ({ where, orderBy }: any = {}) => {
        let arr = Array.from(this.repositoryGrants.values());
        if (where?.projectId)
          arr = arr.filter((g: any) => g.projectId === where.projectId);
        if (where?.teamId)
          arr = arr.filter((g: any) => g.teamId === where.teamId);
        if (where?.status)
          arr = arr.filter((g: any) => g.status === where.status);
        if (orderBy?.grantedAt === 'desc')
          arr = arr.sort(
            (a: any, b: any) => b.grantedAt.getTime() - a.grantedAt.getTime(),
          );
        return arr;
      },
      findFirst: async ({ where, orderBy }: any = {}) => {
        let arr = Array.from(this.repositoryGrants.values());
        if (where?.projectId)
          arr = arr.filter((g: any) => g.projectId === where.projectId);
        if (where?.status)
          arr = arr.filter((g: any) => g.status === where.status);
        if (orderBy?.grantedAt === 'desc')
          arr = arr.sort(
            (a: any, b: any) => b.grantedAt.getTime() - a.grantedAt.getTime(),
          );
        return arr[0] || null;
      },
      findUnique: async ({ where }: any) =>
        this.repositoryGrants.get(where.id) || null,
      update: async ({ where, data }: any) => {
        const rec = this.repositoryGrants.get(where.id);
        if (!rec) return null;
        const updated = { ...rec, ...data };
        if (data.status === 'REVOKED' && !rec.revokedAt) {
          updated.revokedAt = new Date();
          const auditId = `audit_${randomUUID()}`;
          this.auditLogs.set(auditId, {
            id: auditId,
            userId: rec.grantedById,
            action: 'REVOKE',
            resource: `repository:${rec.projectId}`,
            details: updated,
            createdAt: new Date(),
          });
        }
        this.repositoryGrants.set(where.id, updated);
        return updated;
      },
    };
  }

  // ---------- GitHubConnection (persistent, encrypted at rest) ----------
  // Stores encryptedAccessToken (AES-256-GCM) — never plaintext in DB.
  // For backwards compat with tests that use `accessToken` field, we mirror both.
  // Production code must use encryptedAccessToken; GitHubService handles encrypt/decrypt.
  get githubConnection() {
    const normalizeRecord = (rec: any) => {
      if (!rec) return rec;
      // Ensure both fields exist for compat: if encryptedAccessToken present, also expose accessToken for internal decrypt path
      // In prod, accessToken will be decrypted on read via TokenEncryptionService, but here we just mirror.
      if (rec.encryptedAccessToken && !rec.accessToken) rec.accessToken = rec.encryptedAccessToken;
      if (rec.accessToken && !rec.encryptedAccessToken) rec.encryptedAccessToken = rec.accessToken;
      return rec;
    };
    return {
      findUnique: async ({ where }: any) => {
        let rec: any = null;
        if (where.userId) rec = this.githubConnections.get(where.userId) || null;
        if (where.id) {
          for (const v of this.githubConnections.values()) if (v.id === where.id) rec = v;
        }
        return normalizeRecord(rec ? { ...rec } : null);
      },
      findFirst: async ({ where }: any) => {
        if (where.userId) {
          const r = this.githubConnections.get(where.userId) || null;
          return normalizeRecord(r ? { ...r } : null);
        }
        return null;
      },
      findMany: async ({ where }: any = {}) => {
        let arr = Array.from(this.githubConnections.values()).map((r) => ({ ...r }));
        if (where?.userId) arr = arr.filter((c: any) => c.userId === where.userId);
        return arr.map(normalizeRecord);
      },
      create: async ({ data }: any) => {
        const id = `ghc_${randomUUID()}`;
        // Support both legacy `accessToken` and new `encryptedAccessToken`
        const encrypted = data.encryptedAccessToken ?? data.accessToken;
        const rec = {
          id,
          ...data,
          encryptedAccessToken: encrypted,
          accessToken: encrypted, // mirror for compat — actual encryption handled in service layer
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.githubConnections.set(data.userId, rec);
        return normalizeRecord({ ...rec });
      },
      upsert: async ({ where, create, update }: any) => {
        const existing = this.githubConnections.get(where.userId);
        if (existing) {
          const encrypted = update.encryptedAccessToken ?? update.accessToken ?? existing.encryptedAccessToken;
          const updated = {
            ...existing,
            ...update,
            encryptedAccessToken: encrypted,
            accessToken: encrypted,
            updatedAt: new Date(),
          };
          this.githubConnections.set(where.userId, updated);
          return normalizeRecord({ ...updated });
        }
        const encrypted = create.encryptedAccessToken ?? create.accessToken;
        const rec = {
          id: `ghc_${randomUUID()}`,
          ...create,
          encryptedAccessToken: encrypted,
          accessToken: encrypted,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.githubConnections.set(create.userId, rec);
        return normalizeRecord({ ...rec });
      },
      delete: async ({ where }: any) => {
        const existing = this.githubConnections.get(where.userId);
        if (existing) this.githubConnections.delete(where.userId);
        return existing ? normalizeRecord({ ...existing }) : null;
      },
    };
  }

  // ---------- AIInteraction (durable, sanitized) ----------
  // NEVER stores raw secrets, access tokens, or entire repository.
  // Stores only: question, sanitized retrieval metadata, analysis scope, model/provider, result metadata, timestamps.
  get aiInteraction() {
    return {
      create: async ({ data }: any) => {
        const id = `aii_${randomUUID()}`;
        const rec = {
          id,
          ...data,
          sanitizedRetrievalMetadata: data.sanitizedRetrievalMetadata ?? data.retrievalMetadata ?? null,
          resultMetadata: data.resultMetadata ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        // Enforce sanitization: strip any secret-looking fields if present
        if (rec.sanitizedRetrievalMetadata && typeof rec.sanitizedRetrievalMetadata === 'object') {
          const s = rec.sanitizedRetrievalMetadata as Record<string, unknown>;
          for (const k of Object.keys(s)) {
            if (/token|secret|password|Authorization|privateKey/i.test(k)) {
              (s as Record<string, unknown>)[k] = '[REDACTED]';
            }
          }
        }
        if (rec.resultMetadata && typeof rec.resultMetadata === 'object') {
          const r = rec.resultMetadata as Record<string, unknown>;
          for (const k of Object.keys(r)) {
            if (/token|secret|password|Authorization|privateKey/i.test(k)) {
              (r as Record<string, unknown>)[k] = '[REDACTED]';
            }
          }
        }
        this.aiInteractions.set(id, rec);
        return { ...rec };
      },
      findUnique: async ({ where }: any) => this.aiInteractions.get(where.id) ?? null,
      findMany: async ({ where, orderBy, take }: any = {}) => {
        let arr = Array.from(this.aiInteractions.values());
        if (where?.userId) arr = arr.filter((r: any) => r.userId === where.userId);
        if (where?.projectId) arr = arr.filter((r: any) => r.projectId === where.projectId);
        if (where?.teamId) arr = arr.filter((r: any) => r.teamId === where.teamId);
        if (orderBy?.createdAt === 'desc') arr = arr.sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime());
        if (orderBy?.createdAt === 'asc') arr = arr.sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime());
        if (take) arr = arr.slice(0, take);
        return arr.map((r) => ({ ...r }));
      },
      findFirst: async ({ where, orderBy }: any = {}) => {
        let arr = Array.from(this.aiInteractions.values());
        if (where?.userId) arr = arr.filter((r: any) => r.userId === where.userId);
        if (where?.projectId) arr = arr.filter((r: any) => r.projectId === where.projectId);
        if (orderBy?.createdAt === 'desc') arr = arr.sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime());
        return arr[0] ?? null;
      },
      update: async ({ where, data }: any) => {
        const rec = this.aiInteractions.get(where.id);
        if (!rec) return null;
        const updated = { ...rec, ...data, updatedAt: new Date() };
        this.aiInteractions.set(where.id, updated);
        return { ...updated };
      },
    };
  }

  // ---------- MentorFeedback ----------
  get mentorFeedback() {
    return {
      create: async ({ data }: any) => {
        const id = `fb_${randomUUID()}`;
        const record = {
          id,
          ...data,
          version: data.version ?? 1,
          isPublished: data.isPublished ?? false,
          isImmutable: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          publishedAt: data.isPublished ? new Date() : null,
        };
        this.feedbacks.set(id, record);
        return record;
      },
      findMany: async ({ where, orderBy }: any) => {
        let results = Array.from(this.feedbacks.values());
        if (where?.projectId)
          results = results.filter((f: any) => f.projectId === where.projectId);
        if (where?.isPublished !== undefined)
          results = results.filter(
            (f: any) => f.isPublished === where.isPublished,
          );
        if (where?.authorId)
          results = results.filter((f: any) => f.authorId === where.authorId);
        if (orderBy?.createdAt === 'desc')
          results = results.sort(
            (a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
        if (orderBy?.createdAt === 'asc')
          results = results.sort(
            (a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime(),
          );
        return results;
      },
      findUnique: async ({ where }: any) => {
        if (where.id) return this.feedbacks.get(where.id) || null;
        return null;
      },
      findFirst: async ({ where }: any) => {
        for (const v of this.feedbacks.values()) {
          if (where.projectId && v.projectId !== where.projectId) continue;
          if (where.id && v.id !== where.id) continue;
          return v;
        }
        return null;
      },
      update: async ({ where, data }: any) => {
        // Enforce immutability: disallow editing feedback text, only allow publishing
        const existing = this.feedbacks.get(where.id);
        if (!existing) return null;
        // If attempting to modify immutable fields, reject unless it's publication
        const immutableFields = [
          'feedback',
          'author',
          'phase',
          'rating',
          'projectId',
        ];
        for (const field of immutableFields) {
          if (data[field] !== undefined && data[field] !== existing[field]) {
            throw new Error(
              `Mentor feedback is immutable. Field ${field} cannot be modified. Create new version instead.`,
            );
          }
        }
        // Allow only isPublished, publishedAt, version
        const allowedUpdate: any = {};
        if (data.isPublished !== undefined) {
          allowedUpdate.isPublished = data.isPublished;
          allowedUpdate.publishedAt =
            data.publishedAt ?? (data.isPublished ? new Date() : null);
        }
        if (data.version !== undefined) allowedUpdate.version = data.version;
        // audit log
        const auditId = `audit_${randomUUID()}`;
        this.auditLogs.set(auditId, {
          id: auditId,
          action: 'FEEDBACK_PUBLISH',
          resource: `feedback:${where.id}`,
          details: {
            before: existing,
            after: { ...existing, ...allowedUpdate },
          },
          createdAt: new Date(),
        });
        const updated = {
          ...existing,
          ...allowedUpdate,
          updatedAt: new Date(),
        };
        this.feedbacks.set(where.id, updated);
        return updated;
      },
    };
  }

  // ---------- EliminationRecord ----------
  get eliminationRecord() {
    return {
      upsert: async ({ where, update, create }: any) => {
        const existing = this.eliminations.get(where.projectId);
        if (existing) {
          const updated = { ...existing, ...update, updatedAt: new Date() };
          this.eliminations.set(where.projectId, updated);
          return updated;
        }
        const createdRecord = {
          id: `elim_${where.projectId}`,
          ...create,
          eliminatedAt: new Date(),
          createdAt: new Date(),
        };
        this.eliminations.set(where.projectId, createdRecord);
        return createdRecord;
      },
      findUnique: async ({ where }: any) =>
        this.eliminations.get(where.projectId) || null,
      findFirst: async ({ where }: any) => {
        for (const v of this.eliminations.values())
          if (v.projectId === where.projectId) return v;
        return null;
      },
      create: async ({ data }: any) => {
        const id = `elim_${Date.now()}`;
        const rec = {
          id,
          ...data,
          eliminatedAt: new Date(),
          createdAt: new Date(),
        };
        this.eliminations.set(data.projectId, rec);
        return rec;
      },
    };
  }

  // ---------- PhaseProgress ----------
  get phaseProgress() {
    return {
      create: async ({ data }: any) => {
        const id = `phase_${randomUUID()}`;
        const rec = { id, ...data, createdAt: new Date() };
        this._phaseProgressStore.set(id, rec);
        return rec;
      },
      findMany: async ({ where, orderBy }: any = {}) => {
        let arr = Array.from(this._phaseProgressStore.values());
        if (where?.projectId)
          arr = arr.filter((p: any) => p.projectId === where.projectId);
        if (where?.isPublished !== undefined)
          arr = arr.filter((p: any) => p.isPublished === where.isPublished);
        if (orderBy?.createdAt === 'desc')
          arr = arr.sort(
            (a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
        return arr;
      },
      findUnique: async ({ where }: any) =>
        this._phaseProgressStore.get(where.id) || null,
      update: async ({ where, data }: any) => {
        const rec = this._phaseProgressStore.get(where.id);
        if (!rec) return null;
        const updated = { ...rec, ...data };
        this._phaseProgressStore.set(where.id, updated);
        return updated;
      },
    };
  }

  // ---------- Mistake ----------
  get mistake() {
    return {
      create: async ({ data }: any) => {
        const id = `mistake_${randomUUID()}`;
        const rec = {
          id,
          ...data,
          isPublished: data.isPublished ?? false,
          createdAt: new Date(),
        };
        this.mistakes.set(id, rec);
        return rec;
      },
      findMany: async ({ where, orderBy }: any = {}) => {
        let arr = Array.from(this.mistakes.values());
        if (where?.projectId)
          arr = arr.filter((m: any) => m.projectId === where.projectId);
        if (where?.isPublished !== undefined)
          arr = arr.filter((m: any) => m.isPublished === where.isPublished);
        if (orderBy?.createdAt === 'desc')
          arr = arr.sort(
            (a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
        return arr;
      },
      findUnique: async ({ where }: any) => this.mistakes.get(where.id) || null,
    };
  }

  // ---------- ImprovementArea ----------
  get improvementArea() {
    return {
      create: async ({ data }: any) => {
        const id = `imp_${randomUUID()}`;
        const rec = {
          id,
          ...data,
          isPublished: data.isPublished ?? false,
          createdAt: new Date(),
        };
        this.improvementAreas.set(id, rec);
        return rec;
      },
      findMany: async ({ where, orderBy }: any = {}) => {
        let arr = Array.from(this.improvementAreas.values());
        if (where?.projectId)
          arr = arr.filter((m: any) => m.projectId === where.projectId);
        if (where?.isPublished !== undefined)
          arr = arr.filter((m: any) => m.isPublished === where.isPublished);
        if (orderBy?.createdAt === 'desc')
          arr = arr.sort(
            (a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
        return arr;
      },
      findUnique: async ({ where }: any) =>
        this.improvementAreas.get(where.id) || null,
    };
  }

  // ---------- Evaluation ----------
  get evaluation() {
    return {
      create: async ({ data }: any) => {
        const id = `eval_${randomUUID()}`;
        const rec = {
          id,
          ...data,
          isPublished: data.isPublished ?? false,
          version: data.version ?? 1,
          createdAt: new Date(),
          publishedAt: data.isPublished ? new Date() : null,
        };
        this.evaluations.set(id, rec);
        return rec;
      },
      findMany: async ({ where, orderBy }: any = {}) => {
        let arr = Array.from(this.evaluations.values());
        if (where?.projectId)
          arr = arr.filter((e: any) => e.projectId === where.projectId);
        if (where?.isPublished !== undefined)
          arr = arr.filter((e: any) => e.isPublished === where.isPublished);
        if (orderBy?.createdAt === 'desc')
          arr = arr.sort(
            (a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
        return arr;
      },
      findUnique: async ({ where }: any) =>
        this.evaluations.get(where.id) || null,
      update: async ({ where, data }: any) => {
        const existing = this.evaluations.get(where.id);
        if (!existing) return null;
        // immutability: prevent editing score/criteria if already published? allow only publishing
        if (existing.isPublished) {
          const immutable = ['score', 'criteria', 'evaluator', 'projectId'];
          for (const f of immutable)
            if (data[f] !== undefined && data[f] !== existing[f])
              throw new Error(`Evaluation is immutable after publication`);
        }
        const updated = { ...existing, ...data, updatedAt: new Date() };
        if (data.isPublished && !existing.isPublished)
          updated.publishedAt = new Date();
        this.evaluations.set(where.id, updated);
        return updated;
      },
    };
  }

  // ---------- ParticipantInsight ----------
  get participantInsight() {
    return {
      create: async ({ data }: any) => {
        const id = `insight_${randomUUID()}`;
        const rec = {
          id,
          ...data,
          isPublished: data.isPublished ?? true,
          createdAt: new Date(),
        };
        this.participantInsights.set(id, rec);
        return rec;
      },
      findMany: async ({ where, orderBy }: any = {}) => {
        let arr = Array.from(this.participantInsights.values());
        if (where?.projectId)
          arr = arr.filter((p: any) => p.projectId === where.projectId);
        if (where?.participantId)
          arr = arr.filter((p: any) => p.participantId === where.participantId);
        if (where?.isPublished !== undefined)
          arr = arr.filter((p: any) => p.isPublished === where.isPublished);
        if (orderBy?.createdAt === 'desc')
          arr = arr.sort(
            (a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
        return arr;
      },
      findUnique: async ({ where }: any) =>
        this.participantInsights.get(where.id) || null,
    };
  }

  // ---------- PostHackathonContinuation ----------
  get postHackathonContinuation() {
    return {
      create: async ({ data }: any) => {
        const id = `cont_${randomUUID()}`;
        const record = { id, ...data, createdAt: new Date() };
        this.continuations.set(id, record);
        return record;
      },
      findMany: async ({ where }: any) =>
        Array.from(this.continuations.values()).filter(
          (c: any) => c.projectId === where.projectId,
        ),
      findFirst: async ({ where }: any) =>
        Array.from(this.continuations.values()).find(
          (c: any) => c.projectId === where.projectId,
        ) || null,
    };
  }

  get projectContinuation() {
    return {
      create: async ({ data }: any) => {
        const id = `projCont_${randomUUID()}`;
        const rec = {
          id,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.projectContinuations.set(data.projectId, rec);
        return rec;
      },
      findUnique: async ({ where }: any) => {
        if (where.projectId)
          return this.projectContinuations.get(where.projectId) || null;
        if (where.id) {
          for (const v of this.projectContinuations.values())
            if (v.id === where.id) return v;
          return null;
        }
        return null;
      },
      findMany: async ({ where }: any = {}) => {
        let arr = Array.from(this.projectContinuations.values());
        if (where?.projectId)
          arr = arr.filter((p: any) => p.projectId === where.projectId);
        return arr;
      },
      upsert: async ({ where, update, create }: any) => {
        const existing = this.projectContinuations.get(where.projectId);
        if (existing) {
          const updated = { ...existing, ...update, updatedAt: new Date() };
          this.projectContinuations.set(where.projectId, updated);
          return updated;
        }
        const created = {
          id: `projCont_${where.projectId}`,
          ...create,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.projectContinuations.set(where.projectId, created);
        return created;
      },
    };
  }

  get projectOpportunity() {
    return {
      create: async ({ data }: any) => {
        const id = `opp_${randomUUID()}`;
        const rec = { id, ...data, createdAt: new Date() };
        this.projectOpportunities.set(id, rec);
        return rec;
      },
      findMany: async ({ where }: any = {}) => {
        let arr = Array.from(this.projectOpportunities.values());
        if (where?.projectId)
          arr = arr.filter((o: any) => o.projectId === where.projectId);
        return arr;
      },
      findFirst: async ({ where }: any) =>
        Array.from(this.projectOpportunities.values()).find(
          (o: any) => o.projectId === where.projectId,
        ) || null,
    };
  }

  get recommendedResource() {
    return {
      create: async ({ data }: any) => {
        const id = `res_${randomUUID()}`;
        const rec = { id, ...data, createdAt: new Date() };
        this.recommendedResources.set(id, rec);
        return rec;
      },
      findMany: async ({ where }: any = {}) => {
        let arr = Array.from(this.recommendedResources.values());
        if (where?.projectId)
          arr = arr.filter((r: any) => r.projectId === where.projectId);
        if (where?.category)
          arr = arr.filter((r: any) => r.category === where.category);
        return arr;
      },
    };
  }

  get roadmapItem() {
    return {
      create: async ({ data }: any) => {
        const id = `road_${randomUUID()}`;
        const rec = {
          id,
          ...data,
          status: data.status ?? 'PLANNED',
          createdAt: new Date(),
        };
        this.roadmapItems.set(id, rec);
        return rec;
      },
      findMany: async ({ where, orderBy }: any = {}) => {
        let arr = Array.from(this.roadmapItems.values());
        if (where?.projectId)
          arr = arr.filter((r: any) => r.projectId === where.projectId);
        if (where?.phase) arr = arr.filter((r: any) => r.phase === where.phase);
        if (orderBy?.createdAt === 'desc')
          arr = arr.sort(
            (a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
        return arr;
      },
      findUnique: async ({ where }: any) =>
        this.roadmapItems.get(where.id) || null,
      update: async ({ where, data }: any) => {
        const rec = this.roadmapItems.get(where.id);
        if (!rec) return null;
        const updated = { ...rec, ...data };
        this.roadmapItems.set(where.id, updated);
        return updated;
      },
    };
  }

  // ---------- AI ----------
  get aiConversation() {
    return {
      create: async ({ data }: any) => {
        const id = data?.id ?? `conv_${randomUUID()}`;
        const rec = {
          ...data,
          id,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.aiConversations.set(id, rec);
        return rec;
      },
      findMany: async ({ where, orderBy }: any = {}) => {
        let arr = Array.from(this.aiConversations.values());
        if (where?.userId)
          arr = arr.filter((c: any) => c.userId === where.userId);
        if (where?.projectId)
          arr = arr.filter((c: any) => c.projectId === where.projectId);
        if (orderBy?.createdAt === 'desc')
          arr = arr.sort(
            (a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
        return arr;
      },
      findUnique: async ({ where }: any) =>
        this.aiConversations.get(where.id) || null,
      findFirst: async ({ where }: any) => {
        for (const v of this.aiConversations.values()) {
          if (where.userId && v.userId !== where.userId) continue;
          if (where.projectId && v.projectId !== where.projectId) continue;
          return v;
        }
        return null;
      },
      update: async ({ where, data }: any) => {
        const rec = this.aiConversations.get(where.id);
        if (!rec) return null;
        const updated = { ...rec, ...data, updatedAt: new Date() };
        this.aiConversations.set(where.id, updated);
        return updated;
      },
    };
  }

  get aiMessage() {
    return {
      create: async ({ data }: any) => {
        const id = `msg_${randomUUID()}`;
        const rec = { id, ...data, createdAt: new Date() };
        this.aiMessages.set(id, rec);
        return rec;
      },
      findMany: async ({ where, orderBy }: any = {}) => {
        let arr = Array.from(this.aiMessages.values());
        if (where?.conversationId)
          arr = arr.filter(
            (m: any) => m.conversationId === where.conversationId,
          );
        if (orderBy?.createdAt === 'asc')
          arr = arr.sort(
            (a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime(),
          );
        if (orderBy?.createdAt === 'desc')
          arr = arr.sort(
            (a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
        return arr;
      },
    };
  }

  get aiAnalysisJob() {
    return {
      create: async ({ data }: any) => {
        const id = `job_${randomUUID()}`;
        const rec = {
          id,
          ...data,
          status: data.status ?? 'PENDING',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.aiAnalysisJobs.set(id, rec);
        return rec;
      },
      findMany: async ({ where, orderBy }: any = {}) => {
        let arr = Array.from(this.aiAnalysisJobs.values());
        if (where?.projectId)
          arr = arr.filter((j: any) => j.projectId === where.projectId);
        if (where?.status)
          arr = arr.filter((j: any) => j.status === where.status);
        if (orderBy?.createdAt === 'desc')
          arr = arr.sort(
            (a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
        return arr;
      },
      findUnique: async ({ where }: any) =>
        this.aiAnalysisJobs.get(where.id) || null,
      findFirst: async ({ where, orderBy }: any) => {
        let arr = Array.from(this.aiAnalysisJobs.values());
        if (where?.projectId)
          arr = arr.filter((j: any) => j.projectId === where.projectId);
        if (orderBy?.createdAt === 'desc')
          arr = arr.sort(
            (a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
        return arr[0] || null;
      },
      update: async ({ where, data }: any) => {
        const rec = this.aiAnalysisJobs.get(where.id);
        if (!rec) return null;
        const updated = { ...rec, ...data, updatedAt: new Date() };
        this.aiAnalysisJobs.set(where.id, updated);
        return updated;
      },
    };
  }

  get aiFinding() {
    return {
      create: async ({ data }: any) => {
        const id = `aif_${randomUUID()}`;
        const rec = { id, ...data, createdAt: new Date() };
        this.aiFindings.set(id, rec);
        return rec;
      },
      findMany: async ({ where }: any = {}) => {
        let arr = Array.from(this.aiFindings.values());
        if (where?.jobId) arr = arr.filter((f: any) => f.jobId === where.jobId);
        return arr;
      },
    };
  }

  get aiRecommendation() {
    return {
      create: async ({ data }: any) => {
        const id = `airec_${randomUUID()}`;
        const rec = { id, ...data, createdAt: new Date() };
        this.aiRecommendations.set(id, rec);
        return rec;
      },
      findMany: async ({ where }: any = {}) => {
        let arr = Array.from(this.aiRecommendations.values());
        if (where?.projectId)
          arr = arr.filter((r: any) => r.projectId === where.projectId);
        if (where?.jobId) arr = arr.filter((r: any) => r.jobId === where.jobId);
        return arr;
      },
    };
  }

  // ---------- AuditLog ----------
  get auditLog() {
    return {
      create: async ({ data }: any) => {
        const id = `audit_${randomUUID()}`;
        const record = { id, ...data, createdAt: new Date() };
        this.auditLogs.set(id, record);
        return record;
      },
      findMany: async (args?: any) => {
        let arr = Array.from(this.auditLogs.values());
        if (args?.where?.userId)
          arr = arr.filter((a: any) => a.userId === args.where.userId);
        if (args?.where?.action)
          arr = arr.filter((a: any) => a.action === args.where.action);
        if (args?.where?.resource)
          arr = arr.filter((a: any) => a.resource === args.where.resource);
        if (args?.orderBy?.createdAt === 'desc')
          arr = arr.sort(
            (a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
        return arr;
      },
      findFirst: async ({ where }: any) => {
        for (const v of this.auditLogs.values()) {
          if (where.action && v.action !== where.action) continue;
          if (where.resource && v.resource !== where.resource) continue;
          return v;
        }
        return null;
      },
    };
  }
}
