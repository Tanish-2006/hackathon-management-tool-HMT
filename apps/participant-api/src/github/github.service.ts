import { Injectable, Logger, ForbiddenException, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import type { GitHubProvider, GitHubRepo } from './github-provider.interface';
import { MockGitHubProvider } from './mock-github.provider';
import { GitHubApiProvider } from './github-api.provider';
import { GitHubAppProvider } from './github-app.provider';
import { GitHubOAuthService } from './github-oauth.service';
import { TokenEncryptionService } from '../security/token-encryption.service';
import { AuditService } from '../audit/audit.service';
import { sanitizeExceptionMessage } from '@hmt/security';

@Injectable()
export class GitHubService {
  private readonly logger = new Logger(GitHubService.name);
  private readonly provider: GitHubProvider;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly oauthService: GitHubOAuthService,
    @Optional() private readonly tokenEncryption?: TokenEncryptionService,
    @Optional() private readonly auditService?: AuditService,
  ) {
    const appId = this.configService.get<string>('GITHUB_APP_ID') || '';
    const privateKey = this.configService.get<string>('GITHUB_PRIVATE_KEY') || '';
    const clientId = this.configService.get<string>('GITHUB_CLIENT_ID') || '';
    if (appId && privateKey) {
      this.provider = new GitHubAppProvider(this.configService);
      this.logger.log('GitHubService using GitHubAppProvider (GITHUB_APP_ID set, production read-only)');
    } else if (!clientId) {
      this.provider = new MockGitHubProvider();
      this.logger.log('GitHubService using MockGitHubProvider (no GITHUB_CLIENT_ID/GITHUB_APP_ID, mock verified)');
    } else {
      this.provider = new GitHubApiProvider(this.configService);
      this.logger.log('GitHubService using GitHubApiProvider (classic OAuth, repo scope — not for production, use GitHub App)');
    }
  }

  getProvider(): GitHubProvider {
    return this.provider;
  }

  isMock(): boolean {
    return this.provider.getProviderName() === 'mock-github';
  }

  // OAuth / GitHub App — both use state tied to HMT user
  getAuthorizationUrl(userId: string): string {
    const state = this.oauthService.generateState(userId);
    // Audit: GITHUB_AUTH_STARTED (safe identifiers only, never token)
    if (this.auditService) {
      // fire-and-forget, never store token
      this.auditService.logGitHubAuthStarted(userId, { provider: this.provider.getProviderName() }).catch(() => {});
    } else {
      // fallback direct prisma audit
      this.prisma.auditLog
        .create({
          data: {
            userId,
            action: 'GITHUB_AUTH_STARTED',
            resource: `user:${userId}`,
            details: { provider: this.provider.getProviderName() },
          },
        } as any)
        .catch(() => {});
    }
    return this.provider.getAuthorizationUrl(state);
  }

  private encryptToken(token: string): string {
    if (this.tokenEncryption) return this.tokenEncryption.encrypt(token);
    // fallback: if no encryption service, store plaintext but warn (dev)
    this.logger.warn('TokenEncryptionService not available — storing token without encryption (dev fallback, not for production)');
    return token;
  }

  private decryptToken(encrypted: string): string {
    if (this.tokenEncryption) return this.tokenEncryption.decrypt(encrypted);
    return encrypted;
  }

  private sanitizeError(e: unknown): Error {
    const msg = e instanceof Error ? e.message : String(e);
    const sanitized = sanitizeExceptionMessage(msg);
    const err = new Error(sanitized);
    if (e instanceof Error && (e as unknown as Record<string, unknown>).statusCode) {
      (err as unknown as Record<string, unknown>).statusCode = (e as unknown as Record<string, unknown>).statusCode;
    }
    if (e instanceof Error && (e as unknown as Record<string, unknown>).code) {
      (err as unknown as Record<string, unknown>).code = (e as unknown as Record<string, unknown>).code;
    }
    return err;
  }

  async handleCallback(code: string, state: string, userId: string): Promise<{ connection: any; githubUser: any }> {
    const isValid = await this.oauthService.validateState(state, userId);
    if (!isValid) {
      if (this.auditService) await this.auditService.logGitHubAuthFailed(userId, 'Invalid OAuth state').catch(() => {});
      else
        await this.prisma.auditLog
          .create({
            data: { userId, action: 'GITHUB_AUTH_FAILED', resource: `user:${userId}`, details: { reason: 'Invalid OAuth state' } },
          } as any)
          .catch(() => {});
      throw Object.assign(new Error('Invalid OAuth state'), { statusCode: 400, code: 'OAUTH_STATE_INVALID' });
    }
    try {
      const tokenData = await this.provider.exchangeCodeForToken(code);
      const githubUser = await this.provider.getAuthenticatedUser(tokenData.accessToken);
      const encryptedToken = this.encryptToken(tokenData.accessToken);
      // Store connection - encrypted at rest, never return to frontend, never log plaintext
      const existing = await this.prisma.githubConnection.findUnique({ where: { userId } } as any);
      let connection: any;
      if (existing) {
        connection = await this.prisma.githubConnection.upsert({
          where: { userId },
          create: {
            userId,
            githubUserId: String(githubUser.id),
            githubLogin: githubUser.login,
            githubUsername: githubUser.login,
            encryptedAccessToken: encryptedToken,
            accessToken: encryptedToken, // compat
            scope: tokenData.scope,
          },
          update: {
            githubUserId: String(githubUser.id),
            githubLogin: githubUser.login,
            encryptedAccessToken: encryptedToken,
            accessToken: encryptedToken,
            scope: tokenData.scope,
          },
        } as any);
      } else {
        connection = await this.prisma.githubConnection.create({
          data: {
            userId,
            githubUserId: String(githubUser.id),
            githubLogin: githubUser.login,
            githubUsername: githubUser.login,
            encryptedAccessToken: encryptedToken,
            accessToken: encryptedToken,
            scope: tokenData.scope,
          },
        } as any);
      }
      // Audit success (safe identifiers only)
      if (this.auditService) await this.auditService.logGitHubAuthCompleted(userId, githubUser.login).catch(() => {});
      else
        await this.prisma.auditLog
          .create({
            data: { userId, action: 'GITHUB_AUTH_COMPLETED', resource: `user:${userId}`, details: { githubLogin: githubUser.login, userId } },
          } as any)
          .catch(() => {});
      this.logger.log(`GitHub account connected for user ${userId} -> ${githubUser.login} (token redacted, encrypted at rest)`);
      // Never return token
      const { accessToken: _a, encryptedAccessToken: _e, ...sanitized } = connection;
      return { connection: sanitized, githubUser };
    } catch (e) {
      const sanitized = this.sanitizeError(e);
      this.logger.warn(`GitHub handleCallback failed for user ${userId}: ${sanitized.message} (redacted)`);
      if (this.auditService) await this.auditService.logGitHubAuthFailed(userId, sanitized.message).catch(() => {});
      else
        await this.prisma.auditLog
          .create({
            data: { userId, action: 'GITHUB_AUTH_FAILED', resource: `user:${userId}`, details: { reason: sanitized.message } },
          } as any)
          .catch(() => {});
      throw sanitized;
    }
  }

  // GitHub App installation callback — uses installation_id instead of code
  async handleAppInstallation(installationId: string, state: string, userId: string): Promise<{ connection: any; githubUser: any }> {
    const isValid = await this.oauthService.validateState(state, userId);
    if (!isValid) {
      if (this.auditService) await this.auditService.logGitHubAuthFailed(userId, 'Invalid OAuth state for GitHub App').catch(() => {});
      throw Object.assign(new Error('Invalid OAuth state for GitHub App'), { statusCode: 400, code: 'OAUTH_STATE_INVALID' });
    }
    try {
      const tokenData = await this.provider.exchangeCodeForToken(installationId);
      const githubUser = await this.provider.getAuthenticatedUser(tokenData.accessToken);
      const encryptedToken = this.encryptToken(tokenData.accessToken);
      const existing = await this.prisma.githubConnection.findUnique({ where: { userId } } as any);
      let connection: any;
      if (existing) {
        connection = await this.prisma.githubConnection.upsert({
          where: { userId },
          create: {
            userId,
            githubUserId: String(githubUser.id),
            githubLogin: githubUser.login,
            githubUsername: githubUser.login,
            encryptedAccessToken: encryptedToken,
            accessToken: encryptedToken,
            scope: tokenData.scope,
            installationId,
          },
          update: {
            githubUserId: String(githubUser.id),
            githubLogin: githubUser.login,
            encryptedAccessToken: encryptedToken,
            accessToken: encryptedToken,
            scope: tokenData.scope,
            installationId,
          },
        } as any);
      } else {
        connection = await this.prisma.githubConnection.create({
          data: {
            userId,
            githubUserId: String(githubUser.id),
            githubLogin: githubUser.login,
            githubUsername: githubUser.login,
            encryptedAccessToken: encryptedToken,
            accessToken: encryptedToken,
            scope: tokenData.scope,
            installationId,
          },
        } as any);
      }
      if (this.auditService) await this.auditService.logGitHubAuthCompleted(userId, githubUser.login).catch(() => {});
      this.logger.log(`GitHub App installed for user ${userId} -> ${githubUser.login} installation ${installationId} (token redacted, encrypted)`);
      const { accessToken: _a, encryptedAccessToken: _e, ...sanitized } = connection;
      return { connection: sanitized, githubUser };
    } catch (e) {
      const sanitized = this.sanitizeError(e);
      this.logger.warn(`GitHub App installation failed for user ${userId}: ${sanitized.message}`);
      if (this.auditService) await this.auditService.logGitHubAuthFailed(userId, sanitized.message).catch(() => {});
      throw sanitized;
    }
  }

  async getConnection(userId: string): Promise<any | null> {
    const conn = await this.prisma.githubConnection.findUnique({ where: { userId } } as any);
    if (!conn) return null;
    // Never expose token
    const { accessToken: _a, encryptedAccessToken: _e, ...sanitized } = conn as Record<string, unknown>;
    return sanitized;
  }

  async disconnect(userId: string): Promise<void> {
    await this.prisma.githubConnection.delete({ where: { userId } } as any);
    if (this.auditService) await this.auditService.logRepositoryDisconnected(userId).catch(() => {});
    else
      await this.prisma.auditLog
        .create({
          data: { userId, action: 'GITHUB_REPOSITORY_DISCONNECTED', resource: `user:${userId}`, details: { userId } },
        } as any)
        .catch(() => {});
    this.logger.log(`GitHub account disconnected for user ${userId} (token purged)`);
  }

  private async getAccessToken(userId: string): Promise<string> {
    const conn = await this.prisma.githubConnection.findUnique({ where: { userId } } as any);
    if (!conn) throw Object.assign(new Error('GitHub account not connected'), { statusCode: 400, code: 'GITHUB_NOT_CONNECTED' });
    const encrypted = (conn as Record<string, string>).encryptedAccessToken ?? (conn as Record<string, string>).accessToken;
    if (!encrypted) throw Object.assign(new Error('GitHub account not connected'), { statusCode: 400, code: 'GITHUB_NOT_CONNECTED' });
    const decrypted = this.decryptToken(encrypted);
    // NEVER log decrypted token
    return decrypted;
  }

  async listRepositories(userId: string): Promise<GitHubRepo[]> {
    try {
      const token = await this.getAccessToken(userId);
      return this.provider.listRepositories(token);
    } catch (e) {
      throw this.sanitizeError(e);
    }
  }

  async getRepository(userId: string, owner: string, repo: string): Promise<GitHubRepo | null> {
    try {
      const token = await this.getAccessToken(userId);
      return this.provider.getRepository(owner, repo, token);
    } catch (e) {
      throw this.sanitizeError(e);
    }
  }

  // Team leader repository selection — READ-ONLY, no write to GitHub
  async connectRepository(params: { userId: string; teamId: string; projectId: string; repoFullName: string }): Promise<any> {
    const { userId, teamId, projectId, repoFullName } = params;
    const membership = await this.prisma.teamMember.findFirst({ where: { userId, teamId } } as any);
    if (!membership) throw new ForbiddenException('Not a member of this team');
    if (membership.role !== 'LEADER' && membership.role !== 'ADMIN') {
      throw new ForbiddenException('Only team leader can connect repository (team leader required)');
    }
    const project = await this.prisma.project.findUnique({ where: { id: projectId } } as any);
    if (!project) throw new NotFoundException('Project not found');
    if (project.teamId !== teamId) throw new ForbiddenException('Project does not belong to this team');
    // 5. GitHub connection must belong to authenticated user — token encrypted at rest, decrypted only in memory for this call
    let token: string;
    try {
      token = await this.getAccessToken(userId);
    } catch (e) {
      throw this.sanitizeError(e);
    }
    const [owner, repo] = repoFullName.split('/');
    if (!owner || !repo) throw Object.assign(new Error('Invalid repoFullName, expected org/repo'), { statusCode: 400 });
    let ghRepo: GitHubRepo | null;
    try {
      ghRepo = await this.provider.getRepository(owner, repo, token);
    } catch (e) {
      throw this.sanitizeError(e);
    }
    if (!ghRepo) throw new NotFoundException('Repository not found or not accessible via GitHub connection');
    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: { repoUrl: `https://github.com/${repoFullName}` },
    } as any);
    this.logger.log(`Repository connected: ${repoFullName} for project ${projectId} by leader ${userId} (read-only, token never logged)`);
    if (this.auditService) await this.auditService.logRepositoryConnected(userId, projectId, repoFullName, teamId).catch(() => {});
    else
      await this.prisma.auditLog
        .create({
          data: {
            userId,
            action: 'GITHUB_REPOSITORY_CONNECTED',
            resource: `project:${projectId}`,
            details: { repoFullName, teamId, projectId },
          },
        } as any)
        .catch(() => {});
    return updated;
  }

  // Explicit grant — only team leader can grant HMT AI analysis access
  async grantAiAccess(params: { userId: string; teamId: string; projectId: string }): Promise<any> {
    const { userId, teamId, projectId } = params;
    const membership = await this.prisma.teamMember.findFirst({ where: { userId, teamId } } as any);
    if (!membership) throw new ForbiddenException('Not a member of this team');
    if (membership.role !== 'LEADER' && membership.role !== 'ADMIN') throw new ForbiddenException('Only team leader can grant AI access');
    const project = await this.prisma.project.findUnique({ where: { id: projectId } } as any);
    if (!project) throw new NotFoundException('Project not found');
    if (project.teamId !== teamId) throw new ForbiddenException('Project does not belong to this team');
    if (!project.repoUrl) throw Object.assign(new Error('No repository connected for this project'), { statusCode: 400 });
    const grant = await this.prisma.repositoryAccessGrant.create({
      data: {
        projectId,
        teamId,
        grantedById: userId,
        status: 'GRANTED',
        repository: project.repoUrl ? project.repoUrl.replace('https://github.com/', '') : undefined,
      },
    } as any);
    this.logger.log(`AI grant created: ${grant.id} for project ${projectId} by leader ${userId} (safe identifiers only)`);
    if (this.auditService) await this.auditService.logGrantCreated(userId, projectId, teamId, grant.id).catch(() => {});
    else
      await this.prisma.auditLog
        .create({
          data: {
            userId,
            action: 'AI_REPOSITORY_GRANT_CREATED',
            resource: `project:${projectId}`,
            details: { grantId: grant.id, projectId, teamId, grantedById: userId },
          },
        } as any)
        .catch(() => {});
    return grant;
  }

  async revokeAiAccess(params: { userId: string; teamId: string; projectId: string; grantId?: string }): Promise<any> {
    const { userId, teamId, projectId, grantId } = params;
    const membership = await this.prisma.teamMember.findFirst({ where: { userId, teamId } } as any);
    if (!membership) throw new ForbiddenException('Not a member');
    if (membership.role !== 'LEADER' && membership.role !== 'ADMIN') throw new ForbiddenException('Only team leader can revoke');
    let grant: any;
    if (grantId) {
      grant = await this.prisma.repositoryAccessGrant.findUnique({ where: { id: grantId } } as any);
    } else {
      grant = await this.prisma.repositoryAccessGrant.findFirst({ where: { projectId, status: 'GRANTED', revokedAt: null } } as any);
    }
    if (!grant) throw new NotFoundException('Grant not found');
    if (grant.teamId !== teamId || grant.projectId !== projectId) throw new ForbiddenException('Grant does not belong to this team/project');
    const revoked = await this.prisma.repositoryAccessGrant.update({
      where: { id: grant.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    } as any);
    this.logger.log(`AI grant revoked: ${grant.id} by ${userId} (immediate denial)`);
    if (this.auditService) await this.auditService.logGrantRevoked(userId, projectId, teamId, grant.id).catch(() => {});
    else
      await this.prisma.auditLog
        .create({
          data: {
            userId,
            action: 'AI_REPOSITORY_GRANT_REVOKED',
            resource: `project:${projectId}`,
            details: { grantId: grant.id, projectId, teamId, revokedById: userId },
          },
        } as any)
        .catch(() => {});
    return revoked;
  }

  // For targeted retrieval — get file content via GitHub, with secret redaction handled by caller
  async getReadmeForProject(projectId: string, userId: string): Promise<string | null> {
    const hasGrant = await this.checkAiGrant(projectId, userId);
    if (!hasGrant) return null;
    const project = await this.prisma.project.findUnique({ where: { id: projectId } } as any);
    if (!project?.repoUrl) return null;
    const { owner, repo } = this.parseRepoUrl(project.repoUrl);
    if (!owner || !repo) return null;
    try {
      const token = await this.getAccessToken(userId);
      return this.provider.getReadme(owner, repo, token);
    } catch (e) {
      throw this.sanitizeError(e);
    }
  }

  async getFileContentForProject(projectId: string, userId: string, path: string): Promise<string | null> {
    const hasGrant = await this.checkAiGrant(projectId, userId);
    if (!hasGrant) throw new ForbiddenException('No active AI grant — retrieval denied');
    const project = await this.prisma.project.findUnique({ where: { id: projectId } } as any);
    if (!project?.repoUrl) return null;
    const { owner, repo } = this.parseRepoUrl(project.repoUrl);
    if (!owner || !repo) return null;
    try {
      const token = await this.getAccessToken(userId);
      return this.provider.getFileContent(owner, repo, path, token);
    } catch (e) {
      throw this.sanitizeError(e);
    }
  }

  private async checkAiGrant(projectId: string, userId: string): Promise<boolean> {
    const grant = await this.prisma.repositoryAccessGrant.findFirst({ where: { projectId, status: 'GRANTED', revokedAt: null } } as any);
    if (!grant) return false;
    // Also ensure revoked check via status
    if (grant.status === 'REVOKED' || grant.revokedAt) return false;
    const project = await this.prisma.project.findUnique({ where: { id: projectId } } as any);
    if (!project) return false;
    const membership = await this.prisma.teamMember.findFirst({ where: { userId, teamId: project.teamId } } as any);
    return !!membership;
  }

  private parseRepoUrl(repoUrl: string): { owner: string; repo: string } {
    const cleaned = repoUrl.replace('https://github.com/', '').replace('http://github.com/', '').replace(/\.git$/, '').split('/').filter(Boolean);
    if (cleaned.length >= 2) return { owner: cleaned[0], repo: cleaned[1] };
    const parts = repoUrl.split('/');
    if (parts.length >= 2) return { owner: parts[parts.length - 2], repo: parts[parts.length - 1] };
    return { owner: '', repo: '' };
  }
}
