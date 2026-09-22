import { Module } from '@nestjs/common';
import { HackathonController } from './hackathon.controller';

@Module({
  controllers: [HackathonController],
})
export class HackathonModule {}
