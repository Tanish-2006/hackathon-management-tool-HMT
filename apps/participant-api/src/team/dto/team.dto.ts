import {
  IsString,
  IsArray,
  IsOptional,
  IsUrl,
  IsNotEmpty,
  IsEnum,
  IsNumber,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VisibilityLevel } from '../../common/enums/visibility.enum';

export class CreateTeamDto {
  @ApiProperty({ example: 'Alpha AI Builders', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
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

export class JoinByCodeDto {
  @ApiProperty({ example: 'Innovators' })
  @IsString()
  @IsNotEmpty()
  teamName: string;

  @ApiProperty({ example: 'HMT-A7K9Q2' })
  @IsString()
  @IsNotEmpty()
  tid: string;

  @ApiProperty({ example: 'hack_123456' })
  @IsString()
  @IsNotEmpty()
  hackathonId: string;
}

export class JoinRequestDto {
  @ApiProperty({ example: 'team_id_123' })
  @IsString()
  @IsNotEmpty()
  teamId: string;

  @ApiPropertyOptional({ example: 'I build APIs and would love to join!' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  message?: string;

  // Short skill answers (4 questions, optional). Stored on the request and
  // shown ONLY to the team leader / authorized reviewers — never to other
  // participants. Not an approval authority, just context.
  @ApiPropertyOptional({ example: 'backend' })
  @IsString()
  @IsOptional()
  @MaxLength(300)
  skillRole?: string;

  @ApiPropertyOptional({ example: 'TypeScript, Postgres' })
  @IsString()
  @IsOptional()
  @MaxLength(300)
  skillLanguages?: string;

  @ApiPropertyOptional({ example: 'Built 3 REST APIs' })
  @IsString()
  @IsOptional()
  @MaxLength(300)
  skillExperience?: string;

  @ApiPropertyOptional({ example: 'APIs, testing, docs' })
  @IsString()
  @IsOptional()
  @MaxLength(300)
  skillContribution?: string;
}

export class TransferLeadershipDto {
  @ApiProperty({ example: 'user_123' })
  @IsString()
  @IsNotEmpty()
  toUserId: string;
}

export class LeaveRequestDto {
  @ApiProperty({ example: 'team_id_123' })
  @IsString()
  @IsNotEmpty()
  teamId: string;
}
