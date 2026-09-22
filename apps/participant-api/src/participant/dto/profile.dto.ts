import { IsString, IsArray, IsOptional, IsUrl } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    example: 'Full-stack builder passionate about AI tooling',
  })
  @IsString()
  @IsOptional()
  bio?: string;

  @ApiPropertyOptional({ example: 'https://github.com/alexdoe' })
  @IsUrl()
  @IsOptional()
  githubUrl?: string;

  @ApiPropertyOptional({ example: ['TypeScript', 'NestJS', 'Neo4j'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  skills?: string[];

  @ApiPropertyOptional({ example: '3 years building devtools' })
  @IsString()
  @IsOptional()
  experience?: string;

  @ApiPropertyOptional({ example: 'https://linkedin.com/in/alexdoe' })
  @IsUrl()
  @IsOptional()
  linkedinUrl?: string;
}
