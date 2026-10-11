import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RosterController } from './roster.controller';
import { RosterService } from './roster.service';

@Module({
  imports: [AuthModule],
  controllers: [RosterController],
  providers: [RosterService],
})
export class RosterModule {}
