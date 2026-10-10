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
    const profile: any = await this.prisma.profile.findUnique({
      where: { userId: req.user.id },
      include: { user: true },
    });
    if (!profile?.user) return profile;
    const { passwordHash, ...user } = profile.user;
    void passwordHash;
    return { ...profile, user };
  }

  @Put()
  async updateProfile(@Req() req: any, @Body() dto: UpdateProfileDto) {
    // fullName lives on the user record, not the profile — split it out so
    // the profile upsert never stores (or rejects) account-level fields.
    // Only known profile fields are persisted; anything else (email, phone,
    // role, …) is dropped here in addition to DTO whitelisting.
    const {
      fullName,
      bio,
      githubUrl,
      skills,
      experience,
      linkedinUrl,
      institution,
      institutionLocation,
      city,
      course,
      yearOfStudy,
    } = dto as UpdateProfileDto & { fullName?: string };
    if (typeof fullName === 'string' && fullName.trim()) {
      await this.prisma.user.update({
        where: { id: req.user.id },
        data: { fullName: fullName.trim().slice(0, 160) },
      } as any);
    }
    const profileFields: Record<string, unknown> = {
      bio,
      githubUrl,
      skills,
      experience,
      linkedinUrl,
      institution,
      institutionLocation,
      city,
      course,
      yearOfStudy,
    };
    for (const key of Object.keys(profileFields)) {
      if (profileFields[key] === undefined) delete profileFields[key];
    }
    const updated = await this.prisma.profile.upsert({
      where: { userId: req.user.id },
      update: { ...profileFields },
      create: { userId: req.user.id, ...profileFields },
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
