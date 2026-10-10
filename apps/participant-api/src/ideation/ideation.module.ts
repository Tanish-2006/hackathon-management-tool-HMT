import { Module } from '@nestjs/common';
import { AsiOneClient } from './asi-one.client';
import { IdeationController } from './ideation.controller';
import { IdeationService } from './ideation.service';

@Module({
  controllers: [IdeationController],
  providers: [AsiOneClient, IdeationService],
})
export class IdeationModule {}
