export interface AIAdviceRequest {
  userPrompt: string;
  // Targeted retrieval — never entire repo
  question?: string;
  problemStatement?: string;
  projectTechStack?: string[];
  findingsSummary?: Array<{
    title: string;
    severity: string;
    category: string;
  }>;
  relevantFiles?: Array<{ path: string; content: string; retrievalReason: string }>;
  readmeContext?: string | null;
  analysisScope?: 'TARGETED';
}

export interface AIAdviceResponse {
  answer: string;
  recommendations: Array<{
    title: string;
    action: string;
    impact: 'HIGH' | 'MEDIUM' | 'LOW';
    category: string;
  }>;
  hackathonStrategyTip: string;
}

export interface PostHackathonRoadmapRequest {
  projectTitle: string;
  projectDescription: string;
  techStack: string[];
  mentorFeedback: string[];
}

export interface PostHackathonRoadmapResponse {
  marketSummary: string;
  targetUsers: string[];
  roadmapPhases: Array<{
    phaseName: string;
    duration: string;
    goals: string[];
  }>;
  nextImmediateSteps: string[];
}

export abstract class AIProvider {
  abstract generateTeammateAdvice(
    request: AIAdviceRequest,
  ): Promise<AIAdviceResponse>;
  abstract generatePostHackathonRoadmap(
    request: PostHackathonRoadmapRequest,
  ): Promise<PostHackathonRoadmapResponse>;
}
