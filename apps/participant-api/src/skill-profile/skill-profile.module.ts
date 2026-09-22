import { Module } from '@nestjs/common';
import { SkillProfileController } from './skill-profile.controller';
@Module({ controllers: [SkillProfileController] })
export class SkillProfileModule {}
