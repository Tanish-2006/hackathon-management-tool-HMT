import { Module } from '@nestjs/common';
import { PerformanceController } from './performance.controller';

@Module({
  controllers: [PerformanceController],
})
export class PerformanceModule {}
