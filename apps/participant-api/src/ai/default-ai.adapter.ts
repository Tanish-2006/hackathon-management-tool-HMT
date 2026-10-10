import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AIProvider,
  AIAdviceRequest,
  AIAdviceResponse,
  PostHackathonRoadmapRequest,
  PostHackathonRoadmapResponse,
} from './ai.provider.interface';
import { AIService } from '@hmt/ai';
import { AIGateway } from '@hmt/ai';
import { getRequestId } from '@hmt/observability';

@Injectable()
export class DefaultAIAdapter extends AIProvider {
  private readonly logger = new Logger(DefaultAIAdapter.name);
  private readonly aiService: AIService;
  private readonly gateway: AIGateway;

  constructor(private readonly configService: ConfigService) {
    super();
    const apiKey = this.configService.get<string>('AI_API_KEY') ?? '';
    const provider = apiKey
      ? ((this.configService.get<string>('AI_PROVIDER') as 'mock' | 'external') ?? 'mock')
      : 'mock';
    const model = this.configService.get<string>('AI_MODEL') ?? '';
    const baseUrl = this.configService.get<string>('AI_BASE_URL') ?? '';
    const timeoutMs = this.configService.get<number>('AI_TIMEOUT_MS') ?? 15000;
    const maxRetries = this.configService.get<number>('AI_MAX_RETRIES') ?? 1;
    this.aiService = new AIService({ provider, apiKey, model, baseUrl, timeoutMs, maxRetries });
    this.gateway = new AIGateway(this.aiService);
    this.logger.log(`AI Gateway initialized with provider=${this.aiService.getProviderName()} model=${this.aiService.getModel()} isMock=${this.aiService.getProviderName() === 'mock'}`);
  }

  async generateTeammateAdvice(
    request: AIAdviceRequest,
  ): Promise<AIAdviceResponse> {
    const requestId = getRequestId();
    this.logger.log(`Generating teammate advice via ${this.gateway.getProviderName()} (requestId=${requestId})`);
    // Delegate to shared gateway — handles mock/external, prompt injection protection, secret redaction
    // Supports targeted retrieval: relevantFiles + readmeContext are DATA, never entire repo
    try {
      const result = await this.gateway.analyzeRepositoryParticipant(
        {
          question: request.question ?? request.userPrompt,
          problemStatement: request.problemStatement ?? null,
          hackathonTheme: null,
          projectTitle: undefined,
          techStack: request.projectTechStack,
          findingsSummary: request.findingsSummary,
          repoContext: { repoUrl: null, sanitizedSnippet: request.userPrompt.slice(0, 2000) },
          relevantFiles: request.relevantFiles,
          readmeContext: request.readmeContext ?? null,
          analysisScope: request.analysisScope ?? 'TARGETED',
        },
        { requestId, userId: undefined },
      );
      // Map shared analysis (hints) to legacy AIAdviceResponse
      const first = result.analysis[0];
      const answer = first ? `${first.problem} Evidence: ${first.evidence} Hint: ${first.hint}` : `AI Teammate Analysis for request: "${request.userPrompt}"`;
      const recommendations = result.analysis.slice(0, 3).map((a, idx) => ({
        title: a.problem.slice(0, 80),
        action: a.hint,
        impact: (idx === 0 ? 'HIGH' : idx === 1 ? 'MEDIUM' : 'LOW') as 'HIGH' | 'MEDIUM' | 'LOW',
        category: 'ANALYSIS',
      }));
      // Ensure no large code blocks
      const sanitizedRecommendations = recommendations.map((r) => ({
        ...r,
        action: r.action.slice(0, 500),
      }));
      return {
        answer: `${result.isMock ? '[MOCK] ' : ''}${answer}`,
        recommendations: sanitizedRecommendations.length ? sanitizedRecommendations : [
          {
            title: 'Implement Resilient API Retry Strategy',
            action: 'Wrap external HTTP calls with exponential backoff.',
            impact: 'HIGH',
            category: 'RELIABILITY',
          },
        ],
        hackathonStrategyTip: 'Focus on robust API contracts and auth before UI polish. AI hints are data, not authority.',
      };
    } catch (e) {
      this.logger.warn(`AI gateway failed, falling back to deterministic mock: ${(e as Error).message}`);
      return {
        answer: `[MOCK] AI Teammate Analysis for request: "${request.userPrompt}". Based on problem statement "${request.problemStatement || 'AI Software Engineering Tool'}", your project needs small, targeted fixes.`,
        recommendations: [
          {
            title: 'Implement Resilient API Retry Strategy',
            action: 'Wrap external HTTP calls with exponential backoff.',
            impact: 'HIGH',
            category: 'RELIABILITY',
          },
          {
            title: 'Sanitize Environment Credentials',
            action: 'Ensure secrets are from env configuration.',
            impact: 'HIGH',
            category: 'SECURITY',
          },
          {
            title: 'Expose Health Probes',
            action: 'Add /health/readiness checks for PostgreSQL, Neo4j, Redis.',
            impact: 'MEDIUM',
            category: 'DEVOPS',
          },
        ],
        hackathonStrategyTip: 'AI output is data, not authority. Verify hints against published hackathon context.',
      };
    }
  }

  async generatePostHackathonRoadmap(
    request: PostHackathonRoadmapRequest,
  ): Promise<PostHackathonRoadmapResponse> {
    this.logger.log(
      `Generating Post-Hackathon continuation roadmap for project: ${request.projectTitle} via ${this.gateway.getProviderName()}`,
    );
    try {
      const result = await this.aiService.generateText({
        taskType: 'POST_HACKATHON_ROADMAP',
        prompt: `Generate roadmap for project "${request.projectTitle}" with techStack ${request.techStack.join(', ')}`,
        requestId: getRequestId(),
      });
      // If external returned JSON, try to parse; else fallback to mock
      try {
        const parsed = JSON.parse(result.text);
        if (parsed.marketSummary) return parsed as PostHackathonRoadmapResponse;
      } catch {}
      // Fallback mock if not JSON
    } catch (e) {
      this.logger.warn(`AI roadmap generation failed, using mock: ${(e as Error).message}`);
    }
    return {
      marketSummary: `[${this.gateway.getProviderName()}] The market for ${request.projectTitle} sits at the intersection of AI developer tooling and automated compliance.`,
      targetUsers: [
        'Hackathon Organizers & University Incubators',
        'Senior Software Architects & Security Audit Teams',
        'Developer Product Teams building internal developer platforms (IDPs)',
      ],
      roadmapPhases: [
        {
          phaseName: 'Phase 1: Commercial Grade Security & AST Parser Upgrade',
          duration: '4 Weeks',
          goals: [
            'Upgrade static parser to support full TypeScript AST parsing via Babel/SWC parser',
            'Integrate OAuth2 GitHub App installation flow for zero-friction repository access',
            'Add webhooks for continuous background code scanning on git push',
          ],
        },
        {
          phaseName: 'Phase 2: SaaS Multi-Tenancy & Analytics Dashboard',
          duration: '6 Weeks',
          goals: [
            'Build team organization workspaces with tenant-isolated database schemas',
            'Implement Neo4j graph visualizations for team skill distribution and mistake mapping',
          ],
        },
      ],
      nextImmediateSteps: [
        'Publish current hackathon build code as an open-source GitHub repository',
        'Incorporate mentor feedback on API client resilience into the primary codebase',
        'Conduct 5 user discovery interviews with developer tool builders',
      ],
    };
  }
}
