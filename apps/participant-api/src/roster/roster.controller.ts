import { Body, Controller, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthRateLimitGuard } from '../common/guards/rate-limit.guard';
import { SyncAuthGuard } from '../sync/sync-auth.guard';
import { RosterEnterDto, RosterImportDto, RosterLookupDto } from './roster.dto';
import { RosterService } from './roster.service';

@ApiTags('roster')
@Controller('roster')
export class RosterController {
  constructor(private readonly roster: RosterService) {}

  @UseGuards(AuthRateLimitGuard)
  @Post('lookup')
  @HttpCode(HttpStatus.OK)
  lookup(@Body() dto: RosterLookupDto) {
    return this.roster.lookup(dto.email);
  }

  @UseGuards(AuthRateLimitGuard)
  @Post('enter')
  @HttpCode(HttpStatus.OK)
  enter(@Body() dto: RosterEnterDto) {
    return this.roster.enter(dto.email, dto.memberId);
  }

  @UseGuards(SyncAuthGuard)
  @Put(':hackathonId')
  import(@Param('hackathonId') hackathonId: string, @Body() dto: RosterImportDto) {
    return this.roster.import(hackathonId, dto.teams);
  }
}
