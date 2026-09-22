import { Controller, Get, Post, Body, Query, UseGuards, Req, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GithubRateLimitGuard } from '../common/guards/rate-limit.guard';
import { GitHubService } from './github.service';
import { GitHubOAuthService } from './github-oauth.service';

@ApiTags('github')
@ApiBearerAuth()
@Controller('github')
@UseGuards(JwtAuthGuard, GithubRateLimitGuard)
export class GitHubController {
  constructor(
    private readonly githubService: GitHubService,
    private readonly oauthService: GitHubOAuthService,
  ) {}

  // Step 1: Get GitHub OAuth/App authorization URL (requires auth, generates state)
  @Get('auth')
  getAuthUrl(@Req() req: any) {
    const url = this.githubService.getAuthorizationUrl(req.user.id);
    const provider = this.githubService.getProvider().getProviderName();
    return { authorizationUrl: url, provider };
  }

  // GitHub App installation URL (alternative to OAuth)
  @Get('app/install')
  getAppInstallUrl(@Req() req: any) {
    const url = this.githubService.getAuthorizationUrl(req.user.id);
    const provider = this.githubService.getProvider().getProviderName();
    return { installationUrl: url, provider };
  }

  // Step 2: Handle OAuth callback (requires auth, validates state, never trusts client-supplied userId)
  @Get('callback')
  async handleCallback(@Req() req: any, @Query('code') code: string, @Query('state') state: string) {
    if (!code || !state) throw new BadRequestException('code and state required');
    // state validation ensures CSRF protection — state must belong to authenticated user
    const result = await this.githubService.handleCallback(code, state, req.user.id);
    // Never expose token
    return { connected: true, githubUser: result.githubUser, connection: result.connection };
  }

  // GitHub App installation callback — handles installation_id + state
  @Get('app/callback')
  async handleAppCallback(@Req() req: any, @Query('installation_id') installationId: string, @Query('state') state: string, @Query('setup_action') _setupAction: string) {
    if (!installationId || !state) throw new BadRequestException('installation_id and state required');
    const result = await this.githubService.handleAppInstallation(installationId, state, req.user.id);
    return { connected: true, githubUser: result.githubUser, connection: result.connection };
  }

  @Get('me')
  async getMe(@Req() req: any) {
    const conn = await this.githubService.getConnection(req.user.id);
    if (!conn) return { connected: false };
    return { connected: true, githubLogin: conn.githubLogin, githubUserId: conn.githubUserId };
  }

  @Get('repositories')
  async listRepositories(@Req() req: any) {
    const repos = await this.githubService.listRepositories(req.user.id);
    // Return sanitized repo list, never tokens
    return repos.map((r) => ({ fullName: r.fullName, name: r.name, owner: r.owner, private: r.private, description: r.description, htmlUrl: r.htmlUrl }));
  }

  // Team leader repository selection — READ-ONLY, no GitHub write
  @Post('connections')
  async connectRepository(@Req() req: any, @Body() body: { teamId: string; projectId: string; repoFullName: string }) {
    if (!body.teamId || !body.projectId || !body.repoFullName) throw new BadRequestException('teamId, projectId, repoFullName required');
    const result = await this.githubService.connectRepository({
      userId: req.user.id,
      teamId: body.teamId,
      projectId: body.projectId,
      repoFullName: body.repoFullName,
    });
    return result;
  }

  @Get('connections')
  async listConnections(@Req() req: any) {
    const conn = await this.githubService.getConnection(req.user.id);
    return conn ? [conn] : [];
  }

  // Explicit grant — only team leader can grant HMT AI analysis access
  @Post('grants')
  async grantAiAccess(@Req() req: any, @Body() body: { teamId: string; projectId: string }) {
    if (!body.teamId || !body.projectId) throw new BadRequestException('teamId, projectId required');
    const grant = await this.githubService.grantAiAccess({
      userId: req.user.id,
      teamId: body.teamId,
      projectId: body.projectId,
    });
    return grant;
  }

  @Post('grants/:id/revoke')
  async revokeAiAccess(@Req() req: any, @Body() body: { teamId: string; projectId: string }) {
    // Also supports revoke via grantId in path, but for simplicity use teamId/projectId
    const grantId = (body as any).grantId || req.params?.id;
    // This endpoint is POST /github/grants/:id/revoke but we also handle body
    // For test, we support both
    const teamId = body.teamId;
    const projectId = body.projectId;
    if (!teamId || !projectId) throw new BadRequestException('teamId, projectId required');
    const revoked = await this.githubService.revokeAiAccess({ userId: req.user.id, teamId, projectId, grantId });
    return revoked;
  }

  // For testing WRITE impossible — no endpoint for push/commit/delete exists intentionally
}
