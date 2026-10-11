import { Module } from '@nestjs/common';
import { AsiOneClient } from './asi-one.client';
import { IdeationController } from './ideation.controller';
import { IdeationGuard } from './ideation.guard';
import { IdeationHub } from './ideation.hub';
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
    IdeationHub,
    ResearchScout,
    MarketGapAnalyst,
  ],
})
export class IdeationModule {}
