import { IsString, IsOptional, IsEnum, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AIChatDto {
  @ApiProperty({ example: 'How do we fix our API and secure our secret keys?' })
  @IsString()
  message: string;

  @ApiPropertyOptional({
    example: 'conv_123',
    description: 'Conversation ID to continue',
  })
  @IsString()
  @IsOptional()
  conversationId?: string;

  @ApiPropertyOptional({ example: 'proj_123' })
  @IsString()
  @IsOptional()
  projectId?: string;
}

export class CreateConversationDto {
  @ApiPropertyOptional({ example: 'Strategy discussion' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: 'proj_123' })
  @IsString()
  @IsOptional()
  projectId?: string;

  @ApiProperty({ example: 'Hello AI, help us win' })
  @IsString()
  initialMessage: string;
}

export class CreateAnalysisJobDto {
  @ApiProperty({ example: 'proj_123' })
  @IsString()
  projectId: string;

  @ApiPropertyOptional({ example: 'REPOSITORY_ANALYSIS' })
  @IsString()
  @IsOptional()
  type?: string;
}
