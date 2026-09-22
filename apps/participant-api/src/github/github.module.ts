import { Module } from '@nestjs/common';
import { GitHubController } from './github.controller';
import { GitHubService } from './github.service';
import { GitHubOAuthService } from './github-oauth.service';
import { MockGitHubProvider } from './mock-github.provider';
import { GitHubApiProvider } from './github-api.provider';
import { TokenEncryptionService } from '../security/token-encryption.service';
import { AuditService } from '../audit/audit.service';

@Module({
  controllers: [GitHubController],
  providers: [
    GitHubOAuthService,
    GitHubService,
    TokenEncryptionService,
    AuditService,
    MockGitHubProvider,
    GitHubApiProvider,
    // Provider selection is inside GitHubService based on GITHUB_CLIENT_ID
  ],
  exports: [GitHubService, GitHubOAuthService, TokenEncryptionService, AuditService],
})
export class GitHubModule {}
