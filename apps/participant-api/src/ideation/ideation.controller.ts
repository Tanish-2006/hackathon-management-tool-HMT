import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, Matches, MaxLength } from 'class-validator';
import type { FastifyReply } from 'fastify';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiRateLimitGuard } from '../common/guards/rate-limit.guard';
import { IdeationService, type IdeationScope } from './ideation.service';

export class SendIdeationMessageDto {
  @ApiProperty({ enum: ['team', 'personal'] })
  @IsIn(['team', 'personal'])
  scope: IdeationScope;

  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @Matches(/\S/, { message: 'content must not be empty' })
  @MaxLength(4000)
  content: string;
}

@ApiTags('ideation')
@ApiBearerAuth()
@Controller('ideation')
@UseGuards(JwtAuthGuard, AiRateLimitGuard)
export class IdeationController {
  constructor(private readonly ideation: IdeationService) {}

  @Get(':hackathonId')
  async state(@Req() req: any, @Param('hackathonId') hackathonId: string) {
    return this.ideation.getState(req.user.id, hackathonId);
  }

  @Post(':hackathonId/messages')
  async send(
    @Req() req: any,
    @Res() reply: FastifyReply,
    @Param('hackathonId') hackathonId: string,
    @Body() dto: SendIdeationMessageDto,
  ): Promise<void> {
    const context = await this.ideation.resolveContext(req.user.id, hackathonId);
    this.ideation.requireScope(context, dto.scope);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string | string[] | number>),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const abort = new AbortController();
    raw.on('close', () => abort.abort());
    const emit = (event: string, data: unknown) => {
      if (!raw.writableEnded) raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    emit('start', { round: context.config.currentRound, scope: dto.scope });
    try {
      const saved = await this.ideation.send(
        context,
        dto.scope,
        dto.content.trim(),
        (text) => emit('delta', { text }),
        abort.signal,
      );
      emit('done', saved);
    } catch (error) {
      emit('error', {
        message: abort.signal.aborted
          ? 'Request cancelled'
          : 'The AI Helper could not answer right now. Please try again in a moment.',
      });
      if (!abort.signal.aborted) req.log?.warn?.({ err: error }, 'ideation stream failed');
    } finally {
      raw.end();
    }
  }
}
