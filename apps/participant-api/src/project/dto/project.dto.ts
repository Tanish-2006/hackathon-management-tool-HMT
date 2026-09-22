import {
  IsString,
  IsArray,
  IsOptional,
  IsEnum,
  IsUrl,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VisibilityLevel } from '../../common/enums/visibility.enum';

export enum ProjectStatusDto {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  SUBMITTED = 'SUBMITTED',
  ARCHIVED = 'ARCHIVED',
}

export class CreateProjectDto {
  @ApiProperty({ example: 'AI Teammate Platform' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'AST-aware developer platform with security scans' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiPropertyOptional({ example: ['NestJS', 'Neo4j', 'Redis'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  techStack?: string[];

  @ApiPropertyOptional({ example: 'https://github.com/team/project' })
  @IsUrl()
  @IsOptional()
  repoUrl?: string;

  @ApiPropertyOptional({
    enum: ProjectStatusDto,
    example: ProjectStatusDto.ACTIVE,
  })
  @IsEnum(ProjectStatusDto)
  @IsOptional()
  status?: ProjectStatusDto;

  @ApiPropertyOptional({
    enum: VisibilityLevel,
    example: VisibilityLevel.TEAM_PRIVATE,
  })
  @IsEnum(VisibilityLevel)
  @IsOptional()
  visibility?: VisibilityLevel;

  @ApiPropertyOptional({ example: 'hack_123' })
  @IsString()
  @IsOptional()
  hackathonId?: string;
}

export class UpdateProjectDto {
  @ApiPropertyOptional() @IsString() @IsOptional() title?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() description?: string;
  @ApiPropertyOptional()
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  techStack?: string[];
  @ApiPropertyOptional() @IsString() @IsOptional() repoUrl?: string;
  @ApiPropertyOptional()
  @IsEnum(ProjectStatusDto)
  @IsOptional()
  status?: ProjectStatusDto;
  @ApiPropertyOptional()
  @IsEnum(VisibilityLevel)
  @IsOptional()
  visibility?: VisibilityLevel;
}

export class CreateMilestoneDto {
  @ApiProperty({ example: 'MVP Complete' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional() @IsString() @IsOptional() description?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() dueDate?: string;
}
