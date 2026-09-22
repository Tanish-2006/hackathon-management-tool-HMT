import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import type { GitHubProvider, GitHubUser, GitHubRepo } from './github-provider.interface';

/**
 * GitHubAppProvider — production GitHub App with fine-grained read-only permissions
 * Contents: READ, Metadata: READ, only selected repositories, no write.
 * Uses GitHub App JWT + installation access token.
 */
@Injectable()
export class GitHubAppProvider implements GitHubProvider {
  private readonly logger = new Logger(GitHubAppProvider.name);

  constructor(private readonly configService: ConfigService) {}

  getProviderName(): string {
    return 'github-app';
  }

  getAuthorizationUrl(state: string): string {
    const appName = this.configService.get<string>('GITHUB_APP_NAME') || '';
    const callbackUrl = this.configService.get<string>('GITHUB_CALLBACK_URL') || '';
    if (!appName) throw Object.assign(new Error('GITHUB_APP_NAME not configured'), { statusCode: 500 });
    // GitHub App installation URL
    const params = new URLSearchParams({ state });
    if (callbackUrl) params.set('redirect_uri', callbackUrl);
    return `https://github.com/apps/${appName}/installations/new?${params.toString()}`;
  }

  async exchangeCodeForToken(code: string): Promise<{ accessToken: string; tokenType: string; scope: string }> {
    // For GitHub App, code is actually installation_id
    // Generate JWT then exchange for installation token
    const installationId = code; // In App flow, code is installation_id
    const token = await this.getInstallationAccessToken(installationId);
    return { accessToken: token, tokenType: 'bearer', scope: 'contents:read metadata:read' };
  }

  private generateAppJWT(): string {
    const appId = this.configService.get<string>('GITHUB_APP_ID') || '';
    let privateKey = this.configService.get<string>('GITHUB_PRIVATE_KEY') || '';
    if (!appId || !privateKey) throw Object.assign(new Error('GITHUB_APP_ID or GITHUB_PRIVATE_KEY not configured'), { statusCode: 500 });
    // Handle escaped newlines
    privateKey = privateKey.replace(/\\n/g, '\n');
    const now = Math.floor(Date.now() / 1000);
    const payload = { iat: now - 60, exp: now + 600, iss: appId };
    return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
  }

  private async getInstallationAccessToken(installationId: string): Promise<string> {
    const jwtToken = this.generateAppJWT();
    const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw Object.assign(new Error(`GitHub App installation token failed: ${res.status} ${text.slice(0, 200)}`), { statusCode: 502 });
    }
    const data = (await res.json()) as { token: string };
    if (!data.token) throw Object.assign(new Error('GitHub App installation token not returned'), { statusCode: 502 });
    this.logger.log('GitHub App installation token generated (redacted)');
    return data.token;
  }

  async getAuthenticatedUser(accessToken: string): Promise<GitHubUser> {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github.v3+json' },
    });
    if (!res.ok) throw Object.assign(new Error(`GitHub App user fetch failed: ${res.status}`), { statusCode: 502 });
    const data = (await res.json()) as GitHubUser & { login: string; id: number };
    return { id: data.id, login: data.login, name: (data as any).name, email: (data as any).email, avatarUrl: (data as any).avatar_url };
  }

  async listRepositories(accessToken: string): Promise<GitHubRepo[]> {
    // For GitHub App, list installation repositories
    const res = await fetch('https://api.github.com/installation/repositories?per_page=100', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github.v3+json' },
    });
    if (!res.ok) throw Object.assign(new Error(`GitHub App list repos failed: ${res.status}`), { statusCode: 502 });
    const data = (await res.json()) as { repositories: Array<{ id: number; full_name: string; name: string; owner: { login: string }; private: boolean; description: string; html_url: string; default_branch: string }> };
    const repos = data.repositories || [];
    return repos.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      name: r.name,
      owner: r.owner.login,
      private: r.private,
      description: r.description,
      htmlUrl: r.html_url,
      defaultBranch: r.default_branch,
    }));
  }

  async getRepository(owner: string, repo: string, accessToken: string): Promise<GitHubRepo | null> {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github.v3+json' },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw Object.assign(new Error(`GitHub App get repo failed: ${res.status}`), { statusCode: 502 });
    const r = (await res.json()) as { id: number; full_name: string; name: string; owner: { login: string }; private: boolean; description: string; html_url: string; default_branch: string };
    return { id: r.id, fullName: r.full_name, name: r.name, owner: r.owner.login, private: r.private, description: r.description, htmlUrl: r.html_url, defaultBranch: r.default_branch };
  }

  async getReadme(owner: string, repo: string, accessToken: string): Promise<string | null> {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github.v3+json' },
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: string; encoding?: string };
    if (data.content && data.encoding === 'base64') {
      try {
        return Buffer.from(data.content, 'base64').toString('utf-8');
      } catch {
        return null;
      }
    }
    return null;
  }

  async getFileContent(owner: string, repo: string, path: string, accessToken: string): Promise<string | null> {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github.v3+json' },
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: string; encoding?: string; type?: string };
    if (data.type === 'dir') return null;
    if (data.content && data.encoding === 'base64') {
      try {
        return Buffer.from(data.content, 'base64').toString('utf-8');
      } catch {
        return null;
      }
    }
    return null;
  }

  async listFiles(owner: string, repo: string, accessToken: string): Promise<string[]> {
    const repoInfo = await this.getRepository(owner, repo, accessToken);
    if (!repoInfo) return [];
    const branch = repoInfo.defaultBranch;
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github.v3+json' },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { tree?: Array<{ path: string; type: string }> };
    if (!data.tree) return [];
    return data.tree.filter((t) => t.type === 'blob').map((t) => t.path);
  }
}
