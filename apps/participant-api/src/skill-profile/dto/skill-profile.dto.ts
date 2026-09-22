import {
  IsString,
  IsArray,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ExperienceLevel,
  VisibilityLevel,
} from '../../common/enums/visibility.enum';

export class CreateSkillProfileDto {
  @ApiPropertyOptional({ example: ['TypeScript', 'Python'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  programmingLanguages?: string[];

  @ApiPropertyOptional({ example: ['NestJS', 'React'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  frameworks?: string[];

  @ApiPropertyOptional({ example: ['PostgreSQL', 'MongoDB'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  databases?: string[];

  @ApiPropertyOptional({ example: ['TensorFlow', 'LLM Fine-tuning'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  aiMl?: string[];

  @ApiPropertyOptional({ example: ['React', 'Tailwind'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  frontend?: string[];

  @ApiPropertyOptional({ example: ['Node.js', 'NestJS'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  backend?: string[];

  @ApiPropertyOptional({ example: ['Docker', 'Kubernetes'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  devOps?: string[];

  @ApiPropertyOptional({ example: ['Figma', 'User Research'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  uiUx?: string[];

  @ApiPropertyOptional({ example: ['Roadmapping', 'PRD'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  product?: string[];

  @ApiPropertyOptional({ example: 4, description: '1-5' })
  @IsInt()
  @Min(1)
  @Max(5)
  @IsOptional()
  communication?: number;

  @ApiPropertyOptional({ example: 3 })
  @IsInt()
  @Min(1)
  @Max(5)
  @IsOptional()
  leadership?: number;

  @ApiPropertyOptional({
    enum: ExperienceLevel,
    example: ExperienceLevel.INTERMEDIATE,
  })
  @IsEnum(ExperienceLevel)
  @IsOptional()
  experienceLevel?: ExperienceLevel;

  @ApiPropertyOptional({ example: ['AI', 'Healthcare'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  interests?: string[];

  @ApiPropertyOptional({ example: '20h/week' })
  @IsString()
  @IsOptional()
  availability?: string;

  @ApiPropertyOptional({
    enum: VisibilityLevel,
    example: VisibilityLevel.TEAM_DISCOVERABLE,
  })
  @IsEnum(VisibilityLevel)
  @IsOptional()
  visibility?: VisibilityLevel;
}

export class UpdateSkillProfileDto extends CreateSkillProfileDto {}
