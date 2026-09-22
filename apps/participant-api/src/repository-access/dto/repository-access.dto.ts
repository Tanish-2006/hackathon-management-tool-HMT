import { IsString, IsOptional, IsUrl, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GrantAccessDto {
  @ApiProperty({ example: 'project_id_123' })
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @ApiPropertyOptional({ example: 'Grant for AI analysis' })
  @IsString()
  @IsOptional()
  note?: string;
}

export class RevokeAccessDto {
  @ApiProperty({ example: 'grant_id_123' })
  @IsString()
  @IsNotEmpty()
  grantId: string;
}
