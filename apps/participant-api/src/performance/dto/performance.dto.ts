import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class IngestFeedbackDto {
  @ApiProperty({ example: 'proj_123' })
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @ApiProperty({ example: 'Senior Mentor' })
  @IsString()
  author: string;

  @ApiPropertyOptional({ example: 'user_id_of_author' })
  @IsString()
  @IsOptional()
  authorId?: string;

  @ApiProperty({ enum: Role, example: Role.MENTOR })
  @IsEnum(Role)
  role: Role;

  @ApiProperty({ example: 'Midway Evaluation' })
  @IsString()
  phase: string;

  @ApiProperty({ example: 'Great architecture, add retry policies' })
  @IsString()
  feedback: string;

  @ApiPropertyOptional({ example: 8.5 })
  @IsNumber()
  @IsOptional()
  rating?: number;

  @ApiPropertyOptional({
    example: false,
    description:
      'If true, organizer publishes immediately; otherwise requires separate publish step',
  })
  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;
}

export class IngestEliminationDto {
  @ApiProperty({ example: 'proj_123' })
  @IsString()
  projectId: string;

  @ApiProperty({ example: 'Missed demo deadline' })
  @IsString()
  reason: string;

  @ApiProperty({ example: 'TIMELINE_MISSED' })
  @IsString()
  category: string;

  @ApiPropertyOptional({ example: 'No repo link at cutoff' })
  @IsString()
  @IsOptional()
  detailedFeedback?: string;
}

export class CreatePhaseProgressDto {
  @ApiProperty({ example: 'proj_123' }) @IsString() projectId: string;
  @ApiProperty({ example: 'Phase 1: Foundation' })
  @IsString()
  phaseName: string;
  @ApiProperty({ example: 'COMPLETED' }) @IsString() status: string;
  @ApiPropertyOptional({ example: 85 })
  @IsNumber()
  @IsOptional()
  score?: number;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() isPublished?: boolean;
}

export class CreateMistakeDto {
  @ApiProperty({ example: 'proj_123' }) @IsString() projectId: string;
  @ApiProperty({ example: 'Missing retry logic' }) @IsString() title: string;
  @ApiProperty({ example: 'API client lacked retry on 503' })
  @IsString()
  description: string;
  @ApiProperty({ example: 'RELIABILITY' }) @IsString() category: string;
  @ApiProperty({ example: 'HIGH' }) @IsString() severity: string;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() isPublished?: boolean;
}

export class CreateImprovementAreaDto {
  @ApiProperty({ example: 'proj_123' }) @IsString() projectId: string;
  @ApiProperty({ example: 'Error Handling' }) @IsString() area: string;
  @ApiProperty({ example: 'Wrap external calls with circuit breaker' })
  @IsString()
  suggestion: string;
  @ApiPropertyOptional({ example: 'HIGH' })
  @IsString()
  @IsOptional()
  priority?: string;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() isPublished?: boolean;
}

export class CreateEvaluationDto {
  @ApiProperty({ example: 'proj_123' }) @IsString() projectId: string;
  @ApiProperty({ example: 'Judge Alice' }) @IsString() evaluator: string;
  @ApiProperty({ enum: Role, example: Role.MENTOR }) @IsEnum(Role) role: Role;
  @ApiProperty({ example: 8.7 }) @IsNumber() score: number;
  @ApiPropertyOptional({ example: '{"technical":8,"innovation":9}' })
  @IsOptional()
  criteria?: any;
  @ApiPropertyOptional() @IsString() @IsOptional() comments?: string;
  @ApiPropertyOptional() @IsBoolean() @IsOptional() isPublished?: boolean;
}

export class CreateParticipantInsightDto {
  @ApiProperty({ example: 'proj_123' }) @IsString() projectId: string;
  @ApiProperty({ example: 'Learned importance of health checks' })
  @IsString()
  insight: string;
  @ApiPropertyOptional() @IsString() @IsOptional() lessonsLearned?: string;
}
