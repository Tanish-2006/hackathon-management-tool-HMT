import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../database/prisma.service';
import { CreateSkillProfileDto } from './dto/skill-profile.dto';
import { PrivacyService } from '../privacy/privacy.service';
import { VisibilityLevel } from '../common/enums/visibility.enum';

@ApiTags('skill-profile')
@ApiBearerAuth()
@Controller('skill-profile')
@UseGuards(JwtAuthGuard)
export class SkillProfileController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly privacy: PrivacyService,
  ) {}

  @Get('me')
  async getMyProfile(@Req() req: any) {
    const profile = await this.prisma.skillProfile.findUnique({
      where: { userId: req.user.id },
    });
    return profile || { message: 'No skill profile yet', profile: null };
  }

  @Put()
  async upsertProfile(@Req() req: any, @Body() dto: CreateSkillProfileDto) {
    const existing = await this.prisma.skillProfile.upsert({
      where: { userId: req.user.id },
      update: { ...dto },
      create: { userId: req.user.id, ...dto },
    });
    return existing;
  }

  @Get('discover')
  async discoverProfiles(
    @Req() req: any,
    @Query('skill') skill?: string,
    @Query('interest') interest?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const p = Math.max(1, parseInt(page || '1', 10) || 1);
    const ps = Math.min(50, Math.max(1, parseInt(pageSize || '10', 10) || 10));
    const all = await this.prisma.skillProfile.findMany({
      where: { visibility: VisibilityLevel.TEAM_DISCOVERABLE } as any,
    });
    let filtered = all.filter((p: any) => p.userId !== req.user.id);
    if (skill) {
      const s = skill.toLowerCase();
      filtered = filtered.filter(
        (p: any) =>
          (p.programmingLanguages || []).some((x: string) =>
            x.toLowerCase().includes(s),
          ) ||
          (p.frameworks || []).some((x: string) =>
            x.toLowerCase().includes(s),
          ) ||
          (p.databases || []).some((x: string) =>
            x.toLowerCase().includes(s),
          ) ||
          (p.aiMl || []).some((x: string) => x.toLowerCase().includes(s)),
      );
    }
    if (interest) {
      const i = interest.toLowerCase();
      filtered = filtered.filter((p: any) =>
        (p.interests || []).some((x: string) => x.toLowerCase().includes(i)),
      );
    }
    const total = filtered.length;
    const paginated = filtered.slice((p - 1) * ps, p * ps);
    // never expose ORGANIZER_ONLY or private profiles; cap response size via pagination
    const data = paginated.map((p: any) => ({
      userId: p.userId,
      programmingLanguages: p.programmingLanguages,
      frameworks: p.frameworks,
      databases: p.databases,
      aiMl: p.aiMl,
      frontend: p.frontend,
      backend: p.backend,
      devOps: p.devOps,
      uiUx: p.uiUx,
      experienceLevel: p.experienceLevel,
      interests: p.interests,
      availability: p.availability,
      visibility: p.visibility,
    }));
    return { data, pagination: { page: p, pageSize: ps, total, totalPages: Math.ceil(total / ps) } };
  }
}
