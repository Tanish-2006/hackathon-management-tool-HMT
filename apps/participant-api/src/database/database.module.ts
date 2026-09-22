import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Neo4jService } from './neo4j.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [PrismaService, Neo4jService, RedisService],
  exports: [PrismaService, Neo4jService, RedisService],
})
export class DatabaseModule {}
