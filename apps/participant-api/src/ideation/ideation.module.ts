import { Module } from '@nestjs/common';
import { AsiOneClient } from './asi-one.client';
import { IdeationController } from './ideation.controller';
import { IdeationGuard } from './ideation.guard';
import { IdeationRouter } from './ideation.router';
import { IdeationService } from './ideation.service';
import { MarketGapAnalyst, ResearchScout } from './ideation.sources';

@Module({
  controllers: [IdeationController],
  providers: [
    AsiOneClient,
    IdeationService,
    IdeationRouter,
    IdeationGuard,
    ResearchScout,
    MarketGapAnalyst,
  ],
})
export class IdeationModule {}
