import {
  IsString,
  IsArray,
  IsOptional,
  IsUrl,
  IsNotEmpty,
  IsEnum,
  IsNumber,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VisibilityLevel } from '../../common/enums/visibility.enum';

export class CreateTeamDto {
  @ApiProperty({ example: 'Alpha AI Builders' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'hack_123456' })
  @IsString()
  @IsNotEmpty()
  hackathonId: string;

  @ApiPropertyOptional({
    enum: VisibilityLevel,
    example: VisibilityLevel.TEAM_DISCOVERABLE,
  })
  @IsEnum(VisibilityLevel)
  @IsOptional()
  visibility?: VisibilityLevel;

  @ApiPropertyOptional({ example: 4 })
  @IsNumber()
  @IsOptional()
  maxMembers?: number;

  @ApiPropertyOptional({ example: ['React', 'Node'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  requiredSkills?: string[];

  @ApiPropertyOptional({ example: ['Must have AI experience'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  requirements?: string[];

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isDiscoverable?: boolean;
}

export class ConnectRepoDto {
  @ApiProperty({ example: 'https://github.com/alice/awesome-project' })
  @IsUrl()
  repoUrl: string;

  @ApiProperty({ example: 'Awesome Project' })
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
}

export class InviteDto {
  @ApiProperty({ example: 'teammate@example.com' })
  @IsString()
  @IsNotEmpty()
  inviteeEmail: string;

  @ApiPropertyOptional({ example: 'Join our AI team!' })
  @IsString()
  @IsOptional()
  message?: string;
}

export class InterestDto {
  @ApiPropertyOptional({ example: 'I love AI and have 3yrs React' })
  @IsString()
  @IsOptional()
  message?: string;
}

export class JoinTeamDto {
  @ApiProperty({ example: 'team_id_123' })
  @IsString()
  teamId: string;
}
