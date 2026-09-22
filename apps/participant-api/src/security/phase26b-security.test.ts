import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GitHubService } from '../github/github.service';
import { GitHubOAuthService } from '../github/github-oauth.service';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../database/redis.service';
import { MockGitHubProvider } from '../github/mock-github.provider';
import { TokenEncryptionService } from './token-encryption.service';
import { AuditService } from '../audit/audit.service';
import { AesGcmEncryptionProvider, sanitizeExceptionMessage } from '@hmt/security';
import { AIInteractionPersistenceService } from '../ai/ai-interaction-persistence.service';
import { ParticipantTargetedRetrievalService } from '../repository/targeted-retrieval.service';
import { RepositoryAnalysisEngine } from '../repository/repository-analysis.engine';

/**
 * Phase 2.6B Security Hardening Tests
 * Covers:
 * - encrypted GitHub credential storage
 * - credential never returned
 * - credential never logged
 * - Redis state expiry / replay / deletion
 * - team isolation / IDOR
 * - revoked grant
 * - unauthorized repository
 * - AI interaction sanitization
 * - audit secret redaction
 * - AI data minimization
 */
describe('Phase 2.6B Persistence + Security Hardening', () => {
  let prisma: PrismaService;
  let redis: RedisService;
  let oauth: GitHubOAuthService;
  let githubService: GitHubService;
  let encryption: TokenEncryptionService;
  let auditService: AuditService;
  let aiPersistence: AIInteractionPersistenceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'GITHUB_CLIENT_ID') return '';
              if (key === 'GITHUB_CLIENT_SECRET') return '';
              if (key === 'GITHUB_CALLBACK_URL') return 'http://localhost:3000/api/v1/github/callback';
              if (key === 'GITHUB_SCOPES') return 'repo read:user';
              if (key === 'GITHUB_TOKEN_ENCRYPTION_KEY') return 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
              if (key === 'ENCRYPTION_KEY') return 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
              return process.env[key];
            },
          },
        },
        PrismaService,
        RedisService,
        {
          provide: AuditService,
          useFactory: (pr: PrismaService) => new AuditService(pr),
          inject: [PrismaService],
        },
        {
          provide: AIInteractionPersistenceService,
          useFactory: (pr: PrismaService) => new AIInteractionPersistenceService(pr),
          inject: [PrismaService],
        },
        {
          provide: GitHubOAuthService,
          useFactory: (cfg: ConfigService, rs: RedisService) => new GitHubOAuthService(cfg, rs),
          inject: [ConfigService, RedisService],
        },
        {
          provide: TokenEncryptionService,
          useFactory: (cfg: ConfigService) => new TokenEncryptionService(cfg),
          inject: [ConfigService],
        },
        MockGitHubProvider,
        ParticipantTargetedRetrievalService,
        RepositoryAnalysisEngine,
        {
          provide: GitHubService,
          useFactory: (config: ConfigService, pr: PrismaService, oauthSvc: GitHubOAuthService, enc: TokenEncryptionService, audit: AuditService) => {
            const svc = new GitHubService(config, pr, oauthSvc, enc, audit);
            (svc as any).provider = new MockGitHubProvider();
            return svc;
          },
          inject: [ConfigService, PrismaService, GitHubOAuthService, TokenEncryptionService, AuditService],
        },
      ],
    }).compile();
    prisma = module.get<PrismaService>(PrismaService);
    redis = module.get<RedisService>(RedisService);
    oauth = module.get<GitHubOAuthService>(GitHubOAuthService);
    githubService = module.get<GitHubService>(GitHubService);
    encryption = module.get<TokenEncryptionService>(TokenEncryptionService);
    auditService = module.get<AuditService>(AuditService);
    aiPersistence = module.get<AIInteractionPersistenceService>(AIInteractionPersistenceService);

    (prisma as any).users.clear();
    (prisma as any).teams.clear();
    (prisma as any).members.clear();
    (prisma as any).projects.clear();
    (prisma as any).projectsById.clear();
    (prisma as any).githubConnections.clear();
    (prisma as any).repositoryGrants.clear();
    (prisma as any).aiInteractions?.clear?.();
    (prisma as any).auditLogs.clear();
    (prisma as any).aiConversations?.clear?.();
    (prisma as any).hackathons?.clear?.();
    await oauth.clearStates();
  });

  describe('encrypted GitHub credential storage', () => {
    it('stores encryptedAccessToken, not plaintext', async () => {
      const user = await (prisma as any).user.create({ data: { email: 'enc@test.com', passwordHash: 'h', fullName: 'Enc' } });
      const state = oauth.generateState(user.id);
      // Simulate callback via githubService.handleCallback (which encrypts)
      const result = await githubService.handleCallback('code123456', state, user.id);
      expect(result.connection).not.toHaveProperty('accessToken');
      expect(result.connection).not.toHaveProperty('encryptedAccessToken');
      // Check DB stores encrypted
      const raw = await (prisma as any).githubConnection.findUnique({ where: { userId: user.id } });
      expect(raw.encryptedAccessToken).toBeDefined();
      expect(raw.encryptedAccessToken).not.toBe('mock_github_token_code1234');
      // Should be base64 encrypted (iv+tag+ciphertext)
      expect(raw.encryptedAccessToken.length).toBeGreaterThan(40);
      // Decrypt via service returns original
      const decrypted = encryption.decrypt(raw.encryptedAccessToken);
      expect(decrypted).toBe('mock_github_token_code1234');
    });

    it('encryption round-trip with AesGcmEncryptionProvider', () => {
      const provider = new AesGcmEncryptionProvider('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
      const plaintext = 'mock_github_token_abc123';
      const enc = provider.encrypt(plaintext);
      expect(enc).not.toBe(plaintext);
      expect(provider.decrypt(enc)).toBe(plaintext);
      expect(provider.isEncrypted(enc)).toBe(true);
      expect(provider.isEncrypted(plaintext)).toBe(false);
    });

    it('encryption key from environment not exposed', () => {
      expect(process.env.GITHUB_TOKEN_ENCRYPTION_KEY || 'fallback').not.toContain('mock_github_token');
      // TokenEncryptionService should not log key
      const svc = encryption as any;
      expect(svc.provider.getKeySource()).toBeDefined();
    });

    it('credential never returned in DTO', async () => {
      const user = await (prisma as any).user.create({ data: { email: 'dto@test.com', passwordHash: 'h', fullName: 'Dto' } });
      await (prisma as any).githubConnection.create({ data: { userId: user.id, githubUserId: '1', githubLogin: 'mockuser', encryptedAccessToken: encryption.encrypt('mock_github_token_secret'), scope: 'repo' } });
      const conn = await githubService.getConnection(user.id);
      expect(conn).not.toHaveProperty('accessToken');
      expect(conn).not.toHaveProperty('encryptedAccessToken');
      expect((conn as any).encryptedAccessToken).toBeUndefined();
      expect(JSON.stringify(conn)).not.toContain('mock_github_token_secret');
    });

    it('credential never logged — sanitizeExceptionMessage', () => {
      const msg = 'Failed with token mock_github_token_abc123 and Authorization: Bearer ghp_1234567890123456789012345678901234';
      const sanitized = sanitizeExceptionMessage(msg);
      expect(sanitized).not.toContain('mock_github_token_abc123');
      expect(sanitized).not.toContain('ghp_1234567890');
      expect(sanitized).toContain('[REDACTED]');
    });

    it('credential never included in AI context', async () => {
      // Build AI context via retrieval — ensure no token leaks
      const retrieval = new ParticipantTargetedRetrievalService();
      const result = await retrieval.retrieveForQuestion('Login issue', undefined);
      const payload = JSON.stringify({ relevantFiles: result.relevantFiles, readmeContext: result.readmeContext });
      expect(payload).not.toContain('mock_github_token');
      expect(payload).not.toContain('ghp_');
      // Authorization header code may appear as pattern but must not contain actual token values
      expect(payload).not.toMatch(/Bearer\s+[a-zA-Z0-9._-]{20,}/);
      expect(payload).not.toContain('sk-');
      // Ensure no entire repository leaked
      expect((result as unknown as Record<string, unknown>).entireRepository).toBeUndefined();
      expect(result.relevantFiles.length).toBeLessThanOrEqual(6);
    });

    it('credential never included in audit details', async () => {
      const user = await (prisma as any).user.create({ data: { email: 'auditsec@test.com', passwordHash: 'h', fullName: 'Audit' } });
      // Simulate audit with token in details — should be redacted
      await auditService.log({ action: 'GITHUB_AUTH_COMPLETED', userId: user.id, resource: `user:${user.id}`, details: { accessToken: 'mock_github_token_secret123', githubLogin: 'mockuser' } as any });
      const logs = await (prisma as any).auditLog.findMany({ where: { userId: user.id } } as any);
      const last = logs[logs.length - 1];
      expect(JSON.stringify(last.details)).not.toContain('mock_github_token_secret123');
      expect(last.details.accessToken).toBe('[REDACTED]');
    });
  });

  describe('Redis temporary state', () => {
    it('TTL around 10 minutes (600s)', async () => {
      expect(oauth.getTtlSeconds()).toBe(600);
      const state = await oauth.generateStateAsync('u1');
      const key = `oauth:github:state:${state}`;
      const val = await redis.get(key);
      expect(val).not.toBeNull();
      // RedisService fallback should have TTL; check expiresAt in JSON
      const rec = JSON.parse(val as string);
      const ttlMs = rec.expiresAt - rec.createdAt;
      expect(ttlMs).toBe(600 * 1000);
    });

    it('one-time use — second consumption fails', async () => {
      const state = oauth.generateState('uA');
      expect(await oauth.validateState(state, 'uA')).toBe(true);
      expect(await oauth.validateState(state, 'uA')).toBe(false);
    });

    it('replay protection — same state replayed rejected', async () => {
      const state = await oauth.generateStateAsync('uReplay');
      expect(await oauth.validateState(state, 'uReplay')).toBe(true);
      // replay
      expect(await oauth.validateState(state, 'uReplay')).toBe(false);
      // also try with wrong user (IDOR) on fresh state
      const state2 = oauth.generateState('uOwner');
      expect(await oauth.validateState(state2, 'uAttacker')).toBe(false);
      // Owner should still be able to use it after attacker fails? Current implementation keeps state after user mismatch (does not delete), so owner can still use. Check that.
      expect(await oauth.validateState(state2, 'uOwner')).toBe(true);
    });

    it('state tied to authenticated user/session', async () => {
      const state = oauth.generateState('userX');
      expect(await oauth.validateState(state, 'userY')).toBe(false);
      expect(await oauth.validateState(state, 'userX')).toBe(true);
    });

    it('delete after successful consumption (Redis and Map)', async () => {
      const state = await oauth.generateStateAsync('uDel');
      const key = `oauth:github:state:${state}`;
      expect(await redis.get(key)).not.toBeNull();
      expect(await oauth.validateState(state, 'uDel')).toBe(true);
      expect(await redis.get(key)).toBeNull();
      expect((oauth as any).states.has(state)).toBe(false);
    });

    it('invalid/expired/replayed state rejected', async () => {
      expect(await oauth.validateState('nonexistent', 'u1')).toBe(false);
      const state = oauth.generateState('u1');
      (oauth as any).states.get(state).expiresAt = Date.now() - 1000;
      // also update Redis copy
      const key = `oauth:github:state:${state}`;
      const raw = await redis.get(key);
      if (raw) {
        const rec = JSON.parse(raw);
        rec.expiresAt = Date.now() - 1000;
        await redis.set(key, JSON.stringify(rec), 600);
      }
      expect(await oauth.validateState(state, 'u1')).toBe(false);
    });

    it('does NOT store long-lived GitHub credentials in Redis', async () => {
      const user = await (prisma as any).user.create({ data: { email: 'nocred@test.com', passwordHash: 'h', fullName: 'NoCred' } });
      const state = await oauth.generateStateAsync(user.id);
      const key = `oauth:github:state:${state}`;
      const val = await redis.get(key);
      expect(val).not.toBeNull();
      expect((val as string)).not.toContain('mock_github_token');
      expect((val as string)).not.toContain('accessToken');
      // Also ensure no GitHub token stored under other Redis keys
      // Check that githubConnections are not in Redis
      expect(await redis.get(`github:token:${user.id}`)).toBeNull();
    });
  });

  describe('team isolation and IDOR', () => {
    it('Team A cannot access Team B repository (IDOR)', async () => {
      const userA = await (prisma as any).user.create({ data: { email: 'ta@test.com', passwordHash: 'h', fullName: 'A' } });
      const userB = await (prisma as any).user.create({ data: { email: 'tb@test.com', passwordHash: 'h', fullName: 'B' } });
      const hack = await (prisma as any).hackathon.create({ data: { title: 'H', description: 'd', problemStatement: 'p', startDate: new Date(), endDate: new Date() } });
      const teamA = await (prisma as any).team.create({ data: { name: 'TA', hackathonId: hack.id } });
      const teamB = await (prisma as any).team.create({ data: { name: 'TB', hackathonId: hack.id } });
      await (prisma as any).teamMember.create({ data: { teamId: teamA.id, userId: userA.id, role: 'LEADER' } });
      await (prisma as any).teamMember.create({ data: { teamId: teamB.id, userId: userB.id, role: 'LEADER' } });
      const projectA = await (prisma as any).project.create({ data: { teamId: teamA.id, title: 'PA', description: 'd', repoUrl: 'https://github.com/mockuser/awesome-project' } });
      await (prisma as any).githubConnection.create({ data: { userId: userA.id, githubUserId: '1', githubLogin: 'mockuser', encryptedAccessToken: encryption.encrypt('mock_github_token_abc'), scope: 'repo' } });
      await githubService.grantAiAccess({ userId: userA.id, teamId: teamA.id, projectId: projectA.id });
      // User B tries to connect repository to projectA (should fail — not member)
      await expect(githubService.connectRepository({ userId: userB.id, teamId: teamA.id, projectId: projectA.id, repoFullName: 'mockuser/awesome-project' })).rejects.toThrow();
      // User B tries to read AI findings for projectA (IDOR)
      const grant = await (prisma as any).repositoryAccessGrant.findFirst({ where: { projectId: projectA.id } });
      expect(grant).toBeDefined();
      // Simulate check as AI controller
      const membershipB = await (prisma as any).teamMember.findFirst({ where: { userId: userB.id, teamId: projectA.teamId } });
      expect(membershipB).toBeNull();
    });

    it('revoked grant immediately denies AI access', async () => {
      const leader = await (prisma as any).user.create({ data: { email: 'rev@test.com', passwordHash: 'h', fullName: 'Rev' } });
      const hack = await (prisma as any).hackathon.create({ data: { title: 'H', description: 'd', problemStatement: 'p', startDate: new Date(), endDate: new Date() } });
      const team = await (prisma as any).team.create({ data: { name: 'T', hackathonId: hack.id } });
      await (prisma as any).teamMember.create({ data: { teamId: team.id, userId: leader.id, role: 'LEADER' } });
      const project = await (prisma as any).project.create({ data: { teamId: team.id, title: 'P', description: 'd', repoUrl: 'https://github.com/mockuser/awesome-project' } });
      const grant = await githubService.grantAiAccess({ userId: leader.id, teamId: team.id, projectId: project.id });
      expect(grant.status).toBe('GRANTED');
      await githubService.revokeAiAccess({ userId: leader.id, teamId: team.id, projectId: project.id, grantId: grant.id });
      const after = await (prisma as any).repositoryAccessGrant.findUnique({ where: { id: grant.id } });
      expect(after.status).toBe('REVOKED');
      expect(after.revokedAt).toBeDefined();
      // AI check should now fail
      const hasGrant = await (prisma as any).repositoryAccessGrant.findFirst({ where: { projectId: project.id, status: 'GRANTED' } });
      expect(hasGrant).toBeNull();
    });

    it('unauthorized repository — cannot grant without repoUrl', async () => {
      const leader = await (prisma as any).user.create({ data: { email: 'unrep@test.com', passwordHash: 'h', fullName: 'Unrep' } });
      const hack = await (prisma as any).hackathon.create({ data: { title: 'H', description: 'd', problemStatement: 'p', startDate: new Date(), endDate: new Date() } });
      const team = await (prisma as any).team.create({ data: { name: 'T', hackathonId: hack.id } });
      await (prisma as any).teamMember.create({ data: { teamId: team.id, userId: leader.id, role: 'LEADER' } });
      const project = await (prisma as any).project.create({ data: { teamId: team.id, title: 'P', description: 'd' } }); // no repoUrl
      await expect(githubService.grantAiAccess({ userId: leader.id, teamId: team.id, projectId: project.id })).rejects.toThrow(/No repository connected/);
    });
  });

  describe('AI interaction sanitization and audit', () => {
    it('AI interaction never stores raw secrets or tokens', async () => {
      const user = await (prisma as any).user.create({ data: { email: 'ai@test.com', passwordHash: 'h', fullName: 'AI' } });
      const hack = await (prisma as any).hackathon.create({ data: { title: 'H', description: 'd', problemStatement: 'p', startDate: new Date(), endDate: new Date() } });
      const team = await (prisma as any).team.create({ data: { name: 'T', hackathonId: hack.id } });
      await (prisma as any).teamMember.create({ data: { teamId: team.id, userId: user.id, role: 'LEADER' } });
      const project = await (prisma as any).project.create({ data: { teamId: team.id, title: 'P', description: 'd', repoUrl: 'https://github.com/mockuser/awesome-project' } });
      // Persist interaction with secret in question
      const rec = await aiPersistence.persist({
        userId: user.id,
        teamId: team.id,
        projectId: project.id,
        question: 'Help with login, my token is mock_github_token_secret123 and password is secret123',
        retrievalMeta: {
          readmeContextPreview: 'README with DATABASE_URL=postgres://user:pass@localhost/db',
          relevantFilesMeta: [{ path: '.env', retrievalReason: 'secret', sizeChars: 100 }],
          retrievalReason: 'TARGETED',
          budgetUsed: { filesRetrieved: 1, rounds: 1, totalChars: 100 },
          hadRepositoryAccess: true,
        },
        analysisScope: 'TARGETED',
        model: 'mock',
        provider: 'mock',
        resultMetadata: { findingsCount: 1 },
        latencyMs: 10,
        success: true,
      });
      expect(rec.question).not.toContain('mock_github_token_secret123');
      expect(rec.question).toContain('[REDACTED');
      expect(JSON.stringify(rec.sanitizedRetrievalMetadata)).not.toContain('postgres://user:pass');
      expect(JSON.stringify(rec.sanitizedRetrievalMetadata)).not.toContain('secret123');
      // Ensure no accessToken stored
      expect(JSON.stringify(rec)).not.toContain('accessToken');
      expect(JSON.stringify(rec)).not.toContain('mock_github_token');
    });

    it('audit secret redaction for all sensitive keys', async () => {
      const user = await (prisma as any).user.create({ data: { email: 'audit@test.com', passwordHash: 'h', fullName: 'Audit' } });
      await auditService.log({ action: 'TEST', userId: user.id, resource: `user:${user.id}`, details: { password: 'secret123', accessToken: 'mock_github_token_abc', Authorization: 'Bearer xyz', githubToken: 'ghp_1234567890123456789012345678901234', safe: 'ok' } as any });
      const logs = await (prisma as any).auditLog.findMany({ where: { userId: user.id } } as any);
      const last = logs[logs.length - 1];
      expect(last.details.password).toBe('[REDACTED]');
      expect(last.details.accessToken).toBe('[REDACTED]');
      expect(last.details.Authorization).toBe('[REDACTED]');
      expect(last.details.safe).toBe('ok');
      expect(JSON.stringify(last.details)).not.toContain('secret123');
    });

    it('audit includes safe identifiers only', async () => {
      const user = await (prisma as any).user.create({ data: { email: 'safe@test.com', passwordHash: 'h', fullName: 'Safe' } });
      await auditService.logGitHubAuthCompleted(user.id, 'mockuser');
      const logs = await (prisma as any).auditLog.findMany({ where: { userId: user.id, action: 'GITHUB_AUTH_COMPLETED' } } as any);
      expect(logs.length).toBeGreaterThan(0);
      const entry = logs[0];
      expect(entry.details.githubLogin).toBe('mockuser');
      expect(entry.details.userId).toBe(user.id);
      expect(JSON.stringify(entry.details)).not.toContain('token');
    });
  });

  describe('AI data minimization', () => {
    it('AI receives only allowed fields, not entireRepository', async () => {
      const svc = new ParticipantTargetedRetrievalService();
      const result = await svc.retrieveForQuestion('Why is login broken?', undefined);
      // Check result structure
      expect(result).toHaveProperty('question');
      expect(result).toHaveProperty('readmeContext');
      expect(result).toHaveProperty('relevantFiles');
      expect(result).toHaveProperty('retrievalReason');
      expect(result).toHaveProperty('analysisScope');
      expect(result).not.toHaveProperty('entireRepository');
      expect((result as any).entireRepository).toBeUndefined();
      expect(result.relevantFiles.length).toBeLessThanOrEqual(6);
      expect(result.relevantFiles.every((f) => f.content.length <= 4000)).toBe(true);
    });

    it('AI must NOT receive tokens, private keys, passwords, JWTs', async () => {
      const content = `
        accessToken: mock_github_token_abc123
        Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
        privateKey: -----BEGIN PRIVATE KEY----- MIIEv...
        DATABASE_URL=postgres://user:password123@localhost/db
      `;
      const redacted = new RepositoryAnalysisEngine().redactSecrets(content);
      expect(redacted).not.toContain('mock_github_token_abc123');
      expect(redacted).not.toContain('password123');
      expect(redacted).toContain('[REDACTED_SECRET]');
      // Ensure retrieval also redacts
      const svc = new ParticipantTargetedRetrievalService();
      // Inject secret file
      (svc as any).mockFiles['backend/src/auth.ts'] = content;
      const result = await svc.retrieveForQuestion('auth failure', undefined);
      const payload = JSON.stringify(result.relevantFiles);
      expect(payload).not.toContain('password123');
    });

    it('AI receives relevantFiles with retrievalReason, not unrelated files', async () => {
      const svc = new ParticipantTargetedRetrievalService();
      const result = await svc.retrieveForQuestion('Why is login not working?', undefined);
      const paths = result.relevantFiles.map((f) => f.path);
      expect(paths).toContain('frontend/src/components/Login.tsx');
      expect(paths).not.toContain('.git/config');
      expect(paths).not.toContain('node_modules/lodash/lodash.js');
      for (const f of result.relevantFiles) {
        expect(f.retrievalReason).toBeDefined();
        expect(f.retrievalReason.length).toBeGreaterThan(0);
      }
    });
  });

  describe('audit persistence for required events', () => {
    it('persists GITHUB_AUTH_STARTED/COMPLETED/FAILED, GITHUB_REPOSITORY_CONNECTED/DISCONNECTED, AI grants and analysis events', async () => {
      const user = await (prisma as any).user.create({ data: { email: 'events@test.com', passwordHash: 'h', fullName: 'Events' } });
      const hack = await (prisma as any).hackathon.create({ data: { title: 'H', description: 'd', problemStatement: 'p', startDate: new Date(), endDate: new Date() } });
      const team = await (prisma as any).team.create({ data: { name: 'T', hackathonId: hack.id } });
      await (prisma as any).teamMember.create({ data: { teamId: team.id, userId: user.id, role: 'LEADER' } });
      const project = await (prisma as any).project.create({ data: { teamId: team.id, title: 'P', description: 'd', repoUrl: 'https://github.com/mockuser/awesome-project' } });

      // 1. Auth started
      githubService.getAuthorizationUrl(user.id);
      // small delay for async audit
      await new Promise((r) => setTimeout(r, 50));
      let logs = await (prisma as any).auditLog.findMany({ where: { userId: user.id } } as any);
      expect(logs.some((l: any) => l.action === 'GITHUB_AUTH_STARTED')).toBe(true);

      // 2. Auth completed via callback
      const state = oauth.generateState(user.id);
      await githubService.handleCallback('codeXYZ123', state, user.id);
      logs = await (prisma as any).auditLog.findMany({ where: { userId: user.id } } as any);
      expect(logs.some((l: any) => l.action === 'GITHUB_AUTH_COMPLETED')).toBe(true);

      // 3. Auth failed (invalid state)
      try {
        await githubService.handleCallback('codeBAD', 'invalid_state_xyz', user.id);
      } catch {}
      logs = await (prisma as any).auditLog.findMany({ where: { userId: user.id } } as any);
      expect(logs.some((l: any) => l.action === 'GITHUB_AUTH_FAILED')).toBe(true);

      // 4. Repository connected
      await githubService.connectRepository({ userId: user.id, teamId: team.id, projectId: project.id, repoFullName: 'mockuser/awesome-project' });
      logs = await (prisma as any).auditLog.findMany({ where: { action: 'GITHUB_REPOSITORY_CONNECTED' } } as any);
      expect(logs.length).toBeGreaterThan(0);

      // 5. Grant created / revoked
      const grant = await githubService.grantAiAccess({ userId: user.id, teamId: team.id, projectId: project.id });
      logs = await (prisma as any).auditLog.findMany({ where: { action: 'AI_REPOSITORY_GRANT_CREATED' } } as any);
      expect(logs.some((l: any) => l.details.grantId === grant.id)).toBe(true);
      await githubService.revokeAiAccess({ userId: user.id, teamId: team.id, projectId: project.id, grantId: grant.id });
      logs = await (prisma as any).auditLog.findMany({ where: { action: 'AI_REPOSITORY_GRANT_REVOKED' } } as any);
      expect(logs.some((l: any) => l.details.grantId === grant.id)).toBe(true);

      // 6. Repository disconnected
      await githubService.disconnect(user.id);
      logs = await (prisma as any).auditLog.findMany({ where: { action: 'GITHUB_REPOSITORY_DISCONNECTED' } } as any);
      expect(logs.some((l: any) => l.userId === user.id)).toBe(true);

      // 7. Analysis requested / denied — need to test via auditService directly (controller would log)
      await auditService.logAnalysisRequested(user.id, project.id);
      await auditService.logAnalysisDenied(user.id, project.id, 'No grant');
      logs = await (prisma as any).auditLog.findMany({ where: { userId: user.id } } as any);
      expect(logs.some((l: any) => l.action === 'AI_REPOSITORY_ANALYSIS_REQUESTED')).toBe(true);
      expect(logs.some((l: any) => l.action === 'AI_REPOSITORY_ANALYSIS_DENIED')).toBe(true);
    });
  });
});
