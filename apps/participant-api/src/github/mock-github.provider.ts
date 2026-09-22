import { Injectable } from '@nestjs/common';
import type { GitHubProvider, GitHubUser, GitHubRepo } from './github-provider.interface';

@Injectable()
export class MockGitHubProvider implements GitHubProvider {
  getProviderName(): string {
    return 'mock-github';
  }

  getAuthorizationUrl(state: string): string {
    return `https://github.com/login/oauth/authorize?client_id=mock_client_id&state=${state}&scope=repo%20read:user`;
  }

  async exchangeCodeForToken(code: string): Promise<{ accessToken: string; tokenType: string; scope: string }> {
    if (!code) throw Object.assign(new Error('Invalid code'), { statusCode: 400 });
    // Deterministic mock token
    return {
      accessToken: `mock_github_token_${code.slice(0, 8)}`,
      tokenType: 'bearer',
      scope: 'repo read:user',
    };
  }

  async getAuthenticatedUser(accessToken: string): Promise<GitHubUser> {
    if (!accessToken.startsWith('mock_github_token_')) throw Object.assign(new Error('Invalid token'), { statusCode: 401 });
    return {
      id: 12345,
      login: 'mockuser',
      name: 'Mock User',
      email: 'mock@example.com',
      avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
    };
  }

  async listRepositories(_accessToken: string): Promise<GitHubRepo[]> {
    return [
      {
        id: 1,
        fullName: 'mockuser/awesome-project',
        name: 'awesome-project',
        owner: 'mockuser',
        private: false,
        description: 'Awesome project for hackathon',
        htmlUrl: 'https://github.com/mockuser/awesome-project',
        defaultBranch: 'main',
      },
      {
        id: 2,
        fullName: 'mockuser/another-repo',
        name: 'another-repo',
        owner: 'mockuser',
        private: true,
        description: 'Another repo',
        htmlUrl: 'https://github.com/mockuser/another-repo',
        defaultBranch: 'main',
      },
    ];
  }

  async getRepository(owner: string, repo: string, _accessToken: string): Promise<GitHubRepo | null> {
    const all = await this.listRepositories('mock_github_token_dummy');
    return all.find((r) => r.owner === owner && r.name === repo) || null;
  }

  async getReadme(owner: string, repo: string, _accessToken: string): Promise<string | null> {
    if (owner === 'mockuser' && repo === 'awesome-project') {
      return `# Awesome Project
Purpose: Team collaboration platform for hackathons
Architecture: NestJS + Fastify + Prisma
Technologies: TypeScript, Node.js
Setup: npm install
Modules: auth, team, project
`;
    }
    return null;
  }

  async getFileContent(owner: string, repo: string, path: string, _accessToken: string): Promise<string | null> {
    // Mock file contents for targeted retrieval tests
    const key = `${owner}/${repo}:${path}`;
    const map: Record<string, string> = {
      'mockuser/awesome-project:README.md': '# Awesome Project\nPurpose: Team collaboration',
      'mockuser/awesome-project:frontend/src/components/Login.tsx': 'export function Login() {} // login component',
      'mockuser/awesome-project:frontend/src/services/auth.ts': 'export async function login() { return fetch("/api/v1/auth/login") }',
      'mockuser/awesome-project:backend/src/routes/auth.ts': 'app.post("/api/v1/auth/login", handler)',
      'mockuser/awesome-project:frontend/src/pages/Dashboard.tsx': 'export function Dashboard() { fetch("/api/v1/dashboard") }',
      'mockuser/awesome-project:frontend/src/api/client.ts': 'export const apiClient = { get: (url) => fetch(url) }',
      'mockuser/awesome-project:backend/src/controllers/dashboard.controller.ts': '@Controller("dashboard") export class DashboardController { @Get() getDashboard() {} }',
      'mockuser/awesome-project:.env': 'DATABASE_URL=postgres://user:password123@localhost/db\nSECRET=sk-1234567890abcdef',
    };
    return map[key] ?? (path.endsWith('.md') ? `# File ${path}` : `// content of ${path}\nconsole.log("hello")`);
  }

  async listFiles(owner: string, repo: string, _accessToken: string): Promise<string[]> {
    // Return mock file list for repo
    if (owner === 'mockuser' && repo === 'awesome-project') {
      return [
        'README.md',
        'frontend/src/components/Login.tsx',
        'frontend/src/services/auth.ts',
        'backend/src/routes/auth.ts',
        'backend/src/services/auth.service.ts',
        'frontend/src/pages/Dashboard.tsx',
        'frontend/src/api/client.ts',
        'backend/src/controllers/dashboard.controller.ts',
        '.env',
      ];
    }
    return [];
  }
}
