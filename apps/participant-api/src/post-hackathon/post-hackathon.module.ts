import { Module } from '@nestjs/common';
import { PostHackathonController } from './post-hackathon.controller';
import { AIModule } from '../ai/ai.module';

@Module({
  imports: [AIModule],
  controllers: [PostHackathonController],
})
export class PostHackathonModule {}
