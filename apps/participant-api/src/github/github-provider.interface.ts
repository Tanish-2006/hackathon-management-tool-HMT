export interface GitHubUser {
  id: number;
  login: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
}

export interface GitHubRepo {
  id: number;
  fullName: string; // org/repo
  name: string;
  owner: string;
  private: boolean;
  description?: string;
  htmlUrl: string;
  defaultBranch: string;
}

export interface GitHubFile {
  path: string;
  content: string; // base64 or raw, we return raw
  size: number;
  sha?: string;
}

export interface GitHubProvider {
  getProviderName(): string;
  // OAuth
  getAuthorizationUrl(state: string): string;
  exchangeCodeForToken(code: string): Promise<{ accessToken: string; tokenType: string; scope: string }>;
  getAuthenticatedUser(accessToken: string): Promise<GitHubUser>;
  // Repo
  listRepositories(accessToken: string): Promise<GitHubRepo[]>;
  getRepository(owner: string, repo: string, accessToken: string): Promise<GitHubRepo | null>;
  getReadme(owner: string, repo: string, accessToken: string): Promise<string | null>;
  getFileContent(owner: string, repo: string, path: string, accessToken: string): Promise<string | null>;
  listFiles(owner: string, repo: string, accessToken: string): Promise<string[]>;
}
