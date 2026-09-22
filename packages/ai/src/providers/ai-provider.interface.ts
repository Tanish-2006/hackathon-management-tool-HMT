import type { AiGenerateTextOptions, AiGenerateTextResult, AiAnalyzeOptions, AiAnalyzeResult } from '../ai.types';

export interface AIProvider {
  getProviderName(): 'mock' | 'external';
  getModel(): string;
  generateText(options: AiGenerateTextOptions): Promise<AiGenerateTextResult>;
  analyze(options: AiAnalyzeOptions): Promise<AiAnalyzeResult>;
}
