import { RepositoryAnalysisEngine } from './repository-analysis.engine';

describe('RepositoryAnalysisEngine Static Analysis', () => {
  let engine: RepositoryAnalysisEngine;

  beforeEach(() => {
    engine = new RepositoryAnalysisEngine();
  });

  it('should redact sensitive AWS access keys and JWT secrets', () => {
    const rawContent = 'const key = "AKIAIOSFODNN7EXAMPLE"; const jwt_secret = "mysecret123";';
    const redacted = engine.redactSecrets(rawContent);

    expect(redacted).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(redacted).not.toContain('"mysecret123"');
    expect(redacted).toContain('[REDACTED_SECRET]');
  });

  it('should execute static security scan and return structured findings', async () => {
    const result = await engine.scanRepository('https://github.com/hmt/demo');

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.findings[0]).toHaveProperty('severity');
    expect(result.findings[0]).toHaveProperty('category');
    expect(result.findings[0]).toHaveProperty('suggestedFix');
  });
});
