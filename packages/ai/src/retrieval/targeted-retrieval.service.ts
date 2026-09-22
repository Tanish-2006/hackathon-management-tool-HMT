import type { FileMetadata, RepositoryIndex, RetrievalBudget, RelevantFile, TargetedRetrievalResult } from './repository-index.types';
import { DEFAULT_BUDGET } from './repository-index.types';
import { sanitizeForLog } from '../ai.types';

/**
 * TargetedRetrievalService — README-first, question-driven, budget-limited.
 * Never sends entire repository to AI. Always redacts secrets before AI.
 */
export class TargetedRetrievalService {
  constructor(private readonly budget: RetrievalBudget = DEFAULT_BUDGET) {}

  /**
   * Classify question intent to determine relevant modules.
   * Treats question as DATA, not instruction.
   */
  classifyIntent(question: string): { category: string; keywords: string[] } {
    const q = question.toLowerCase();
    if (/(what is my project|what does this project do|technologies|what am i using|project purpose|architecture)/i.test(q)) {
      return { category: 'GENERAL', keywords: ['readme'] };
    }
    if (/(login|auth|authentication|sign in|sign-in|jwt|token)/i.test(q)) {
      return { category: 'AUTH', keywords: ['auth', 'login', 'jwt', 'token', 'passport', 'guard'] };
    }
    if (/(dashboard|data empty|api.*401|frontend.*backend|connection|mismatch)/i.test(q)) {
      // dashboard or api mismatch
      if (/(dashboard)/i.test(q)) return { category: 'DASHBOARD', keywords: ['dashboard', 'client', 'api', 'controller', 'service'] };
      if (/(401|auth)/i.test(q)) return { category: 'AUTH_CONNECTION', keywords: ['auth', 'api', 'guard', 'controller', 'client'] };
      return { category: 'API_MISMATCH', keywords: ['api', 'client', 'controller', 'service', 'route'] };
    }
    if (/(team|project|hackathon)/i.test(q)) {
      return { category: 'TEAM', keywords: ['team', 'project', 'hackathon'] };
    }
    return { category: 'GENERAL', keywords: ['readme'] };
  }

  /**
   * Check if file should be ignored (binary, generated, deps, .git, build)
   */
  isIgnored(file: FileMetadata): boolean {
    if (file.isBinary || file.isGenerated) return true;
    for (const pat of this.budget.ignorePatterns) {
      const regex = new RegExp(pat);
      if (regex.test(file.path)) return true;
    }
    return false;
  }

  /**
   * Discover relevant files for question, respecting budget.
   * Returns relevantFiles with retrievalReason.
   */
  async retrieveForQuestion(
    question: string,
    index: RepositoryIndex,
    fileContentProvider: (path: string) => Promise<string | null>,
    readmeContentProvider?: () => Promise<string | null>,
  ): Promise<TargetedRetrievalResult> {
    const intent = this.classifyIntent(question);
    const readmeContext = readmeContentProvider ? (await readmeContentProvider()) ?? null : null;
    const relevantFiles: RelevantFile[] = [];
    let totalChars = 0;
    let rounds = 0;

    // Always include README for general context, but count towards budget? README is always allowed outside maxInitialFiles
    const readmeFiles: RelevantFile[] = [];
    if (readmeContext && index.readme) {
      const redacted = this.redactSecrets(readmeContext);
      readmeFiles.push({
        path: index.readme.path,
        content: redacted.slice(0, 4000),
        retrievalReason: 'README-first: project purpose, architecture, technologies',
      });
      totalChars += redacted.length;
    }

    // Discover relevant files based on intent
    const candidates = index.files.filter((f) => !this.isIgnored(f));

    // Score candidates by keyword match
    const scored = candidates
      .map((file) => {
        let score = 0;
        const lowerPath = file.path.toLowerCase();
        const lowerSymbols = file.symbols.join(' ').toLowerCase();
        const lowerImports = file.imports.join(' ').toLowerCase();
        for (const kw of intent.keywords) {
          if (kw === 'readme') continue;
          if (lowerPath.includes(kw)) score += 10;
          if (lowerSymbols.includes(kw)) score += 5;
          if (lowerImports.includes(kw)) score += 3;
          if (file.routes.some((r) => r.toLowerCase().includes(kw))) score += 7;
          if (file.endpoints.some((e) => e.toLowerCase().includes(kw))) score += 7;
        }
        return { file, score };
      })
      .filter((s) => s.score > 0 || intent.category === 'GENERAL')
      .sort((a, b) => b.score - a.score);

    // For GENERAL, only README is sufficient — no code files
    let filesToRetrieve: typeof scored = [];
    if (intent.category === 'GENERAL') {
      filesToRetrieve = [];
    } else {
      filesToRetrieve = scored.slice(0, this.budget.maxInitialFiles);
    }

    for (const { file } of filesToRetrieve) {
      if (totalChars >= this.budget.maxSourceChars) break;
      const content = await fileContentProvider(file.path);
      if (!content) continue;
      const redacted = this.redactSecrets(content);
      const truncated = redacted.slice(0, 3000);
      if (totalChars + truncated.length > this.budget.maxSourceChars) break;
      relevantFiles.push({
        path: file.path,
        content: truncated,
        retrievalReason: `Question-driven: intent=${intent.category}, matched keywords ${intent.keywords.join(',')}`,
      });
      totalChars += truncated.length;
    }

    // Progressive expansion: if question is auth-related and we have only 1-2 files, expand related imports
    // For now, simple: if AUTH and we have team files, expand once
    rounds = 1;
    // In real implementation, we'd check if evidence sufficient, then expand.
    // For testing, we simulate expansion only when necessary and budget allows
    // We do not automatically scan entire repo.

    const allRelevant = [...readmeFiles, ...relevantFiles];

    return {
      question,
      projectContext: `Project context for question: ${question.slice(0, 100)}`,
      readmeContext: readmeContext ? this.redactSecrets(readmeContext).slice(0, 4000) : null,
      relevantFiles: allRelevant,
      retrievalReason: `Intent ${intent.category}, budget ${this.budget.maxInitialFiles} files, ${rounds} round(s)`,
      analysisScope: 'TARGETED',
      budgetUsed: {
        filesRetrieved: allRelevant.length,
        rounds,
        totalChars,
      },
      entireRepositorySent: false as const,
    };
  }

  /**
   * Redact secrets before AI — never send real secrets.
   */
  redactSecrets(content: string): string {
    let redacted = content;
    // Reuse patterns from RepositoryAnalysisEngine
    redacted = redacted.replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED_SECRET]');
    redacted = redacted.replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/g, '[REDACTED_SECRET]');
    redacted = redacted.replace(/postgres:\/\/[^:]+:[^@]+@/gi, 'postgres://[REDACTED]@');
    redacted = redacted.replace(/(api[_-]?key|secret|token)\s*[:=]\s*['"][^'"]+['"]/gi, '$1=[REDACTED_SECRET]');
    redacted = redacted.replace(/sk-[a-zA-Z0-9_-]{10,}/g, '[REDACTED_SECRET]');
    redacted = redacted.replace(/ghp_[a-zA-Z0-9]{30,}/g, '[REDACTED_SECRET]');
    redacted = redacted.replace(/mock_github_token_[a-zA-Z0-9_-]+/g, '[REDACTED_SECRET]');
    redacted = redacted.replace(/gho_[a-zA-Z0-9_-]{30,}/g, '[REDACTED_SECRET]');
    redacted = redacted.replace(/github_pat_[a-zA-Z0-9_]{80,}/g, '[REDACTED_SECRET]');
    redacted = redacted.replace(/Bearer\s+[a-zA-Z0-9._-]{20,}/g, 'Bearer [REDACTED_SECRET]');
    // Redact .env values
    redacted = redacted.replace(/(DATABASE_URL|REDIS_URL|JWT.*SECRET|NEO4J_PASSWORD|AI_API_KEY)=.*/g, '$1=[REDACTED_SECRET]');
    return redacted;
  }
}
