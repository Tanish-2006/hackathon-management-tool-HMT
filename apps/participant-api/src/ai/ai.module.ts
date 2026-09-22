import { Module } from '@nestjs/common';
import { AIController } from './ai.controller';
import { AIProvider } from './ai.provider.interface';
import { DefaultAIAdapter } from './default-ai.adapter';
import { RepositoryModule } from '../repository/repository.module';
import { AIInteractionPersistenceService } from './ai-interaction-persistence.service';
import { AuditService } from '../audit/audit.service';

@Module({
  imports: [RepositoryModule],
  controllers: [AIController],
  providers: [
    DefaultAIAdapter,
    {
      provide: AIProvider,
      useExisting: DefaultAIAdapter,
    },
    AIInteractionPersistenceService,
    AuditService,
  ],
  exports: [AIProvider, AIInteractionPersistenceService],
})
export class AIModule {}
