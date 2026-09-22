import { Module, forwardRef } from '@nestjs/common';
import { RepositoryController } from './repository.controller';
import { RepositoryAnalysisEngine } from './repository-analysis.engine';
import { ParticipantTargetedRetrievalService } from './targeted-retrieval.service';
import { GitHubModule } from '../github/github.module';

@Module({
  imports: [forwardRef(() => GitHubModule)],
  controllers: [RepositoryController],
  providers: [RepositoryAnalysisEngine, ParticipantTargetedRetrievalService],
  exports: [RepositoryAnalysisEngine, ParticipantTargetedRetrievalService],
})
export class RepositoryModule {}
