import { GitHubAppProvider } from './github-app.provider';
import { ConfigService } from '@nestjs/config';

describe('GitHubAppProvider — production read-only', () => {
  let provider: GitHubAppProvider;

  beforeEach(() => {
    const config = {
      get: (key: string) => {
        if (key === 'GITHUB_APP_ID') return '12345';
        if (key === 'GITHUB_PRIVATE_KEY') return `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA1234567890
-----END RSA PRIVATE KEY-----`;
        if (key === 'GITHUB_APP_NAME') return 'hmt-app';
        return undefined;
      },
    } as unknown as ConfigService;
    provider = new GitHubAppProvider(config);
  });

  it('has no write methods', () => {
    expect((provider as any).createCommit).toBeUndefined();
    expect((provider as any).push).toBeUndefined();
    expect((provider as any).deleteFile).toBeUndefined();
    expect((provider as any).updateFile).toBeUndefined();
    expect((provider as any).createBranch).toBeUndefined();
  });

  it('getProviderName is github-app', () => {
    expect(provider.getProviderName()).toBe('github-app');
  });

  it('getAuthorizationUrl returns GitHub App installation URL with state', () => {
    const url = provider.getAuthorizationUrl('test-state-123');
    expect(url).toContain('https://github.com/apps/hmt-app/installations/new');
    expect(url).toContain('state=test-state-123');
  });

  it('throws if GITHUB_APP_NAME not configured', () => {
    const badConfig = { get: () => '' } as unknown as ConfigService;
    const badProvider = new GitHubAppProvider(badConfig);
    expect(() => badProvider.getAuthorizationUrl('s')).toThrow(/GITHUB_APP_NAME/);
  });

  it('listRepositories in stub returns empty when not configured (no token)', async () => {
    global.fetch = jest.fn(async () =>
      ({
        ok: true,
        json: async () => ({ repositories: [] }),
      }) as unknown as Response,
    ) as unknown as typeof fetch;
    const repos = await provider.listRepositories('fake-token');
    expect(Array.isArray(repos)).toBe(true);
    expect(repos).toEqual([]);
    (global.fetch as unknown as jest.Mock).mockRestore?.();
  });

  it('exposes only read-only operations', () => {
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(provider));
    expect(methods).not.toContain('push');
    expect(methods).not.toContain('delete');
    expect(methods).not.toContain('createCommit');
  });
});
