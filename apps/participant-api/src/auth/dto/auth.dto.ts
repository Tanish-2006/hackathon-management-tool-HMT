import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({
    example: 'alex@example.com',
    description: 'Unique participant email',
  })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Str0ngP@ssw0rd!', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;

  @ApiProperty({ example: 'Alex Doe' })
  @IsString()
  fullName: string;
}

export class LoginDto {
  @ApiProperty({ example: 'alex@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Str0ngP@ssw0rd!' })
  @IsString()
  password: string;
}

export class RefreshDto {
  @ApiProperty({
    description: 'Raw refresh token returned from login/register',
  })
  @IsString()
  refreshToken: string;
}

export class EmailVerificationRequestDto {
  @ApiProperty({ example: 'alex@example.com' })
  @IsEmail()
  email: string;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'Verification token' })
  @IsString()
  token: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'alex@example.com' })
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Reset token' })
  @IsString()
  token: string;

  @ApiProperty({ example: 'NewStr0ngP@ss!', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class PasswordResetConfirmDto {
  @ApiProperty({ example: 'reset_token_here' })
  @IsString()
  token: string;

  @ApiProperty({ example: 'NewStrongPass123!' })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
