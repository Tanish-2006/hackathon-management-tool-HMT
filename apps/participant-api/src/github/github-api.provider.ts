import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GitHubProvider, GitHubUser, GitHubRepo } from './github-provider.interface';

@Injectable()
export class GitHubApiProvider implements GitHubProvider {
  private readonly logger = new Logger(GitHubApiProvider.name);
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly callbackUrl: string;
  private readonly scopes: string;

  constructor(private readonly configService: ConfigService) {
    this.clientId = this.configService.get<string>('GITHUB_CLIENT_ID') || '';
    this.clientSecret = this.configService.get<string>('GITHUB_CLIENT_SECRET') || '';
    this.callbackUrl = this.configService.get<string>('GITHUB_CALLBACK_URL') || '';
    this.scopes = this.configService.get<string>('GITHUB_SCOPES') || 'repo read:user';
  }

  getProviderName(): string {
    return 'github-api';
  }

  getAuthorizationUrl(state: string): string {
    if (!this.clientId) throw Object.assign(new Error('GITHUB_CLIENT_ID not configured'), { statusCode: 500 });
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      scope: this.scopes,
      state,
      allow_signup: 'false',
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  async exchangeCodeForToken(code: string): Promise<{ accessToken: string; tokenType: string; scope: string }> {
    if (!this.clientId || !this.clientSecret) throw Object.assign(new Error('GitHub OAuth not configured'), { statusCode: 500 });
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: this.callbackUrl,
      }),
    });
    if (!res.ok) throw Object.assign(new Error(`GitHub token exchange failed: ${res.status}`), { statusCode: 502 });
    const data = (await res.json()) as { access_token?: string; token_type?: string; scope?: string; error?: string };
    if (data.error || !data.access_token) throw Object.assign(new Error(`GitHub OAuth error: ${data.error || 'no token'}`), { statusCode: 502 });
    // Never log token
    this.logger.log('GitHub token exchanged successfully (redacted)');
    return { accessToken: data.access_token, tokenType: data.token_type || 'bearer', scope: data.scope || '' };
  }

  async getAuthenticatedUser(accessToken: string): Promise<GitHubUser> {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github.v3+json', 'X-Request-Id': `hmt-${Date.now()}` },
    });
    if (!res.ok) throw Object.assign(new Error(`GitHub user fetch failed: ${res.status}`), { statusCode: 502 });
    const data = (await res.json()) as GitHubUser & { login: string; id: number };
    return { id: data.id, login: data.login, name: (data as any).name, email: (data as any).email, avatarUrl: (data as any).avatar_url };
  }

  async listRepositories(accessToken: string): Promise<GitHubRepo[]> {
    const res = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github.v3+json' },
    });
    if (!res.ok) throw Object.assign(new Error(`GitHub list repos failed: ${res.status}`), { statusCode: 502 });
    const data = (await res.json()) as Array<{ id: number; full_name: string; name: string; owner: { login: string }; private: boolean; description: string; html_url: string; default_branch: string }>;
    return data.map((r) => ({
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
    if (!res.ok) throw Object.assign(new Error(`GitHub get repo failed: ${res.status}`), { statusCode: 502 });
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
    // Use git trees API to list files (recursive)
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
