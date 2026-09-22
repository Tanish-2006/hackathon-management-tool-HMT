import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { AIModule } from './ai/ai.module';
import { HealthModule } from './health/health.module';
import { ProfileModule } from './participant/profile.module';
import { HackathonModule } from './hackathon/hackathon.module';
import { TeamModule } from './team/team.module';
import { RepositoryModule } from './repository/repository.module';
import { PerformanceModule } from './performance/performance.module';
import { PostHackathonModule } from './post-hackathon/post-hackathon.module';
import { SkillProfileModule } from './skill-profile/skill-profile.module';
import { ProjectModule } from './project/project.module';
import { RepositoryAccessModule } from './repository-access/repository-access.module';
import { PrivacyModule } from './privacy/privacy.module';
import { GitHubModule } from './github/github.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

/**
 * Root application module — organizes feature domains into isolated modules.
 * All modules depend on DatabaseModule (global) for Prisma/Redis/Neo4j.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
    DatabaseModule,
    PrivacyModule,
    AuthModule,
    AIModule,
    HealthModule,
    ProfileModule,
    SkillProfileModule,
    HackathonModule,
    TeamModule,
    ProjectModule,
    RepositoryModule,
    RepositoryAccessModule,
    PerformanceModule,
    PostHackathonModule,
    GitHubModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
