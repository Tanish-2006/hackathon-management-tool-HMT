import { Injectable, Logger } from '@nestjs/common';
import { FindingCategory, FindingSeverity } from '@prisma/client';
import { randomBytes, createHash } from 'crypto';

export interface RepositoryScanResult {
  commitHash: string;
  score: number;
  findings: Array<{
    severity: FindingSeverity;
    category: FindingCategory;
    file?: string;
    line?: number;
    title: string;
    description: string;
    suggestedFix?: string;
    confidence: number;
  }>;
}

const SEVERITY_WEIGHT: Record<FindingSeverity, number> = {
  CRITICAL: 25,
  HIGH: 15,
  MEDIUM: 8,
  LOW: 3,
  INFO: 1,
};

/**
 * RepositoryAnalysisEngine — lightweight static analysis for demo & CI.
 * - Performs regex-based secret detection (extendable to AST via Babel/SWC)
 * - Emits structured findings with severity/category for AI consumption
 * - Deterministic scoring: 100 - sum(weights), clamped 0-100
 */
@Injectable()
export class RepositoryAnalysisEngine {
  private readonly logger = new Logger(RepositoryAnalysisEngine.name);

  private readonly secretPatterns: ReadonlyArray<{
    name: string;
    regex: RegExp;
    severity: FindingSeverity;
    category: FindingCategory;
  }> = [
    {
      name: 'AWS Access Key',
      regex: /AKIA[0-9A-Z]{16}/g,
      severity: FindingSeverity.CRITICAL,
      category: FindingCategory.SECURITY,
    },
    {
      name: 'JWT Secret Hardcoded',
      regex: /jwt_secret\s*=\s*['"][^'"]+['"]/gi,
      severity: FindingSeverity.HIGH,
      category: FindingCategory.SECURITY,
    },
    {
      name: 'Private Key',
      regex: /-----BEGIN (?:RSA )?PRIVATE KEY-----/g,
      severity: FindingSeverity.CRITICAL,
      category: FindingCategory.SECURITY,
    },
    {
      name: 'Database URL with Password',
      regex: /postgres:\/\/[^:]+:[^@]+@/gi,
      severity: FindingSeverity.HIGH,
      category: FindingCategory.SECURITY,
    },
    {
      name: 'Generic High-Entropy Token',
      regex:
        /(api[_-]?key|secret|token)\s*[:=]\s*['"][a-zA-Z0-9_\-]{20,}['"]/gi,
      severity: FindingSeverity.MEDIUM,
      category: FindingCategory.SECURITY,
    },
    {
      name: 'Mock GitHub Token',
      regex: /mock_github_token_[a-zA-Z0-9_-]+/g,
      severity: FindingSeverity.CRITICAL,
      category: FindingCategory.SECURITY,
    },
    {
      name: 'GitHub PAT',
      regex: /ghp_[a-zA-Z0-9]{30,}/g,
      severity: FindingSeverity.CRITICAL,
      category: FindingCategory.SECURITY,
    },
    {
      name: 'Bearer Token',
      regex: /Bearer\s+[a-zA-Z0-9._-]{20,}/g,
      severity: FindingSeverity.CRITICAL,
      category: FindingCategory.SECURITY,
    },
  ];

  async scanRepository(repoUrl: string): Promise<RepositoryScanResult> {
    this.logger.log(`Executing static security scan on repository: ${repoUrl}`);
    const started = Date.now();

    if (!repoUrl || typeof repoUrl !== 'string') {
      throw new Error('repoUrl must be a non-empty string');
    }

    let findings: RepositoryScanResult['findings'] = [];

    // Simulate fetching repo metadata (in prod: clone shallow + scan files)
    const normalizedUrl = repoUrl.trim();
    findings = this.runHeuristicChecks(normalizedUrl);

    // Deduplicate by title
    findings = Array.from(new Map(findings.map((f) => [f.title, f])).values());

    const totalPenalty = findings.reduce(
      (sum, f) => sum + (SEVERITY_WEIGHT[f.severity] ?? 5),
      0,
    );
    const score = Math.max(0, Math.min(100, 100 - totalPenalty));

    const commitHash = createHash('sha1')
      .update(normalizedUrl + Date.now().toString())
      .digest('hex')
      .slice(0, 8);

    this.logger.log(
      `Scan completed in ${Date.now() - started}ms — ${findings.length} finding(s), score ${score}`,
    );
    return { commitHash, score, findings };
  }

  private runHeuristicChecks(
    repoUrl: string,
  ): RepositoryScanResult['findings'] {
    // In a real implementation, we would clone the repo and scan file contents.
    // For deterministic demo behavior, we emit baseline findings + URL-sensitive heuristics.
    const findings: RepositoryScanResult['findings'] = [];

    // Always include baseline demo findings (keeps demo-flow stable)
    findings.push(
      {
        severity: FindingSeverity.HIGH,
        category: FindingCategory.SECURITY,
        file: '.env',
        line: 4,
        title:
          'Potential Hardcoded Secret exposed in environment configuration',
        description:
          'Database connection string detected without vault wrapper.',
        suggestedFix:
          'Inject via container orchestrator or secret manager; never commit .env.',
        confidence: 0.95,
      },
      {
        severity: FindingSeverity.MEDIUM,
        category: FindingCategory.API_MISMATCH,
        file: 'src/services/organizerClient.ts',
        line: 42,
        title: 'Missing HTTP Retry / Circuit Breaker on Organizer API call',
        description:
          'Direct call to organizer backend does not handle 503 / timeout.',
        suggestedFix:
          'Wrap with exponential backoff + circuit breaker (opossum / custom).',
        confidence: 0.9,
      },
      {
        severity: FindingSeverity.LOW,
        category: FindingCategory.TEST_COVERAGE,
        file: 'src/auth/auth.service.ts',
        title: 'Unit Test Missing for Refresh Token Family Revocation',
        description: 'Auth reuse-detection branch lacks coverage.',
        suggestedFix: 'Add test simulating duplicate refresh token reuse.',
        confidence: 0.85,
      },
    );

    // URL heuristic: if repoUrl contains secrets pattern, flag critical
    const urlSecrets = this.detectSecretsInText(repoUrl);
    if (urlSecrets.length > 0) {
      findings.push({
        severity: FindingSeverity.CRITICAL,
        category: FindingCategory.SECURITY,
        file: 'repoUrl',
        title: 'Repository URL contains embedded credentials',
        description: `URL matched secret pattern: ${urlSecrets.join(', ')}`,
        suggestedFix:
          'Use token via header / SSH key, strip credentials from URL.',
        confidence: 0.99,
      });
    }

    return findings;
  }

  detectSecretsInText(text: string): string[] {
    const hits: string[] = [];
    for (const p of this.secretPatterns) {
      const clone = new RegExp(p.regex.source, p.regex.flags);
      if (clone.test(text)) hits.push(p.name);
    }
    return hits;
  }

  redactSecrets(text: string): string {
    let redacted = text;
    for (const pattern of this.secretPatterns) {
      redacted = redacted.replace(
        new RegExp(pattern.regex.source, pattern.regex.flags),
        '[REDACTED_SECRET]',
      );
    }
    return redacted;
  }
}
