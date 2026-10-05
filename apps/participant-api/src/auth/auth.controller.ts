import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  UseInterceptors,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LoginDto,
  RefreshDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyEmailDto,
  RequestPhoneOtpDto,
  VerifyPhoneDto,
} from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthRateLimitGuard } from '../common/guards/rate-limit.guard';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('auth')
@Controller('auth')
@UseGuards(AuthRateLimitGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register participant' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto) {
    return this.authService.refreshToken(dto.refreshToken);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: any, @Body() dto: RefreshDto) {
    return this.authService.logout(req.user.id, dto.refreshToken);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(@Req() req: any) {
    return this.authService.logoutAll(req.user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@Req() req: any) {
    return this.authService.getMe(req.user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('request-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request email verification (architecture)' })
  async requestVerification(@Req() req: any) {
    return this.authService.requestEmailVerification(req.user.id);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email with token' })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('phone/request-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend phone verification OTP (Phase 1 phone identity)' })
  async requestPhoneOtp(@Req() req: any, @Body() dto: RequestPhoneOtpDto) {
    return this.authService.requestPhoneOtp(req.user.id, dto.phoneNumber);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('phone/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify phone number with OTP (Phase 1 phone identity)' })
  async verifyPhone(@Req() req: any, @Body() dto: VerifyPhoneDto) {
    return this.authService.verifyPhone(req.user.id, dto.phoneNumber, dto.otp);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate password reset' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password with token' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  @ApiOperation({ summary: 'List active sessions / devices' })
  async getSessions(@Req() req: any) {
    return this.authService.getSessions(req.user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('sessions/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke specific session by familyId' })
  async revokeSession(@Req() req: any, @Body() body: { familyId: string }) {
    return this.authService.revokeSession(req.user.id, body.familyId);
  }
}
