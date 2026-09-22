import { Controller, Get, Put, Body, UseGuards, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../database/prisma.service';
import { Neo4jService } from '../database/neo4j.service';
import { UpdateProfileDto } from './dto/profile.dto';

@ApiTags('profile')
@ApiBearerAuth()
@Controller('profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly neo4j: Neo4jService,
  ) {}

  @Get()
  async getProfile(@Req() req: any) {
    return this.prisma.profile.findUnique({
      where: { userId: req.user.id },
      include: { user: true },
    });
  }

  @Put()
  async updateProfile(@Req() req: any, @Body() dto: UpdateProfileDto) {
    const updated = await this.prisma.profile.upsert({
      where: { userId: req.user.id },
      update: { ...dto },
      create: { userId: req.user.id, ...dto },
    });

    if (dto.skills && dto.skills.length > 0) {
      for (const skill of dto.skills) {
        this.neo4j
          .write(
            `
          MERGE (p:Participant {id: $userId})
          MERGE (s:Skill {name: $skill})
          MERGE (p)-[:HAS_SKILL]->(s)
          `,
            { userId: req.user.id, skill },
          )
          .catch(() => {});
      }
    }

    return updated;
  }
}
