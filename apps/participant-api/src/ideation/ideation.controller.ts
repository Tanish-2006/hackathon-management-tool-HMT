import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { FastifyReply } from 'fastify';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiRateLimitGuard } from '../common/guards/rate-limit.guard';
import { AiBusyError } from './asi-one.client';
import { IdeationGuard, type GuardRejection } from './ideation.guard';
import {
  IdeationService,
  MAX_DECK_CHARS,
  MAX_DECK_SLIDES,
  MAX_MESSAGE_CHARS,
  type IdeationContext,
  type IdeationScope,
  type SendResult,
  type StreamEmitter,
} from './ideation.service';

export class SendIdeationMessageDto {
  @ApiProperty({ enum: ['team', 'personal'] })
  @IsIn(['team', 'personal'])
  scope: IdeationScope;

  @ApiProperty({ maxLength: MAX_MESSAGE_CHARS })
  @IsString()
  @Matches(/\S/, { message: 'content must not be empty' })
  @MaxLength(MAX_MESSAGE_CHARS)
  content: string;
}

export class DeckSlideDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(1000)
  index: number;

  @ApiProperty({ maxLength: MAX_DECK_CHARS })
  @IsString()
  @MaxLength(MAX_DECK_CHARS)
  title: string;

  @ApiProperty({ maxLength: MAX_DECK_CHARS })
  @IsString()
  @MaxLength(MAX_DECK_CHARS)
  text: string;
}

export class ReviewDeckDto {
  @ApiProperty({ enum: ['team', 'personal'] })
  @IsIn(['team', 'personal'])
  scope: IdeationScope;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @Matches(/\S/, { message: 'fileName must not be empty' })
  @MaxLength(200)
  fileName: string;

  @ApiProperty({ type: [DeckSlideDto], maxItems: MAX_DECK_SLIDES })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_DECK_SLIDES)
  @ValidateNested({ each: true })
  @Type(() => DeckSlideDto)
  slides: DeckSlideDto[];
}

@ApiTags('ideation')
@ApiBearerAuth()
@Controller('ideation')
@UseGuards(JwtAuthGuard)
export class IdeationController {
  constructor(
    private readonly ideation: IdeationService,
    private readonly guard: IdeationGuard,
  ) {}

  @Get(':hackathonId')
  @UseGuards(AiRateLimitGuard)
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
    const content = dto.content.trim();
    const rejection = this.guard.check(context.userId, hackathonId);
    if (rejection) return this.reject(reply, rejection);
    await this.stream(req, reply, context, dto.scope, (emit, signal) =>
      this.ideation.send(context, dto.scope, content, emit, signal),
    );
  }

  @Post(':hackathonId/deck')
  async deck(
    @Req() req: any,
    @Res() reply: FastifyReply,
    @Param('hackathonId') hackathonId: string,
    @Body() dto: ReviewDeckDto,
  ): Promise<void> {
    const context = await this.ideation.resolveContext(req.user.id, hackathonId);
    this.ideation.requireScope(context, dto.scope);
    await this.ideation.assertDeckAllowed(context, dto.scope, dto.slides);
    const rejection = this.guard.check(context.userId, hackathonId);
    if (rejection) return this.reject(reply, rejection);
    await this.stream(req, reply, context, dto.scope, (emit, signal) =>
      this.ideation.reviewDeck(context, dto.scope, dto.fileName.trim(), dto.slides, emit, signal),
    );
  }

  private reject(reply: FastifyReply, rejection: GuardRejection): void {
    reply.status(429).header('Retry-After', String(rejection.retryAfter)).send(rejection);
  }

  private async stream(
    req: any,
    reply: FastifyReply,
    context: IdeationContext,
    scope: IdeationScope,
    run: (emit: StreamEmitter, signal: AbortSignal) => Promise<SendResult>,
  ): Promise<void> {
    const phase = await this.ideation.threadPhase(this.ideation.threadId(context, scope));
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
    const emit: StreamEmitter = (event, data) => {
      if (!raw.writableEnded) raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    emit('start', { phase });
    try {
      emit('done', await run(emit, abort.signal));
    } catch (error) {
      if (abort.signal.aborted) emit('error', { message: 'Request cancelled' });
      else if (error instanceof AiBusyError)
        emit('error', {
          message:
            'The AI coach is very busy right now. Your message is saved — try again shortly.',
          retryAfter: 5,
        });
      else {
        emit('error', {
          message:
            'The AI coach could not answer right now. Your message is saved — please try again in a moment.',
        });
        req.log?.warn?.({ err: error }, 'ideation stream failed');
      }
    } finally {
      raw.end();
    }
  }
}
