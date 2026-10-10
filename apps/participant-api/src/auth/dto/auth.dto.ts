import { IsEmail, IsString, MinLength, MaxLength, Matches, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// E.164: leading +, country code, 8-15 digits total (ITU-T E.164).
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

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
  @MaxLength(128, { message: 'Password must be at most 128 characters' })
  password: string;

  @ApiProperty({ example: 'Alex Doe', maxLength: 160 })
  @IsString()
  @Matches(/\S/, { message: 'fullName must not be empty' })
  @MaxLength(160, { message: 'fullName must be at most 160 characters' })
  fullName: string;

  @ApiProperty({
    example: '+919876543210',
    description: 'Unique participant phone number in E.164 format',
  })
  @IsString()
  @Matches(E164_PATTERN, { message: 'phoneNumber must be in E.164 format (e.g. +919876543210)' })
  phoneNumber: string;
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
  @MaxLength(128)
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

export class RequestPhoneOtpDto {
  @ApiProperty({
    example: '+919876543210',
    description: 'Resend OTP to the phone number on your account (E.164)',
  })
  @IsString()
  @Matches(E164_PATTERN, { message: 'phoneNumber must be in E.164 format (e.g. +919876543210)' })
  phoneNumber: string;
}

export class VerifyPhoneDto {
  @ApiProperty({ example: '+919876543210' })
  @IsString()
  @Matches(E164_PATTERN, { message: 'phoneNumber must be in E.164 format (e.g. +919876543210)' })
  phoneNumber: string;

  @ApiProperty({ example: '482913', description: '6-digit OTP sent to the phone number' })
  @IsString()
  @Length(6, 6, { message: 'OTP must be 6 digits' })
  @Matches(/^\d{6}$/, { message: 'OTP must be 6 digits' })
  otp: string;
}
