import { IsString, IsArray, IsOptional, IsUrl, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Alex Doe' })
  @IsString()
  @IsOptional()
  @MaxLength(160)
  fullName?: string;

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

  // Basic participant details (shown on the Profile page and reused by the
  // hackathon registration form — never duplicated anywhere else).
  @ApiPropertyOptional({ example: 'National Institute of Technology' })
  @IsString()
  @IsOptional()
  @MaxLength(160)
  institution?: string;

  @ApiPropertyOptional({ example: 'Tiruchirappalli, Tamil Nadu' })
  @IsString()
  @IsOptional()
  @MaxLength(160)
  institutionLocation?: string;

  @ApiPropertyOptional({ example: 'Chennai' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: 'Computer Science' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  course?: string;

  @ApiPropertyOptional({ example: '3rd Year' })
  @IsString()
  @IsOptional()
  @MaxLength(40)
  yearOfStudy?: string;
}
