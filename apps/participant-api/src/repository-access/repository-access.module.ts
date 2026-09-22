import { Module } from '@nestjs/common';
import { RepositoryAccessController } from './repository-access.controller';
@Module({ controllers: [RepositoryAccessController] })
export class RepositoryAccessModule {}
