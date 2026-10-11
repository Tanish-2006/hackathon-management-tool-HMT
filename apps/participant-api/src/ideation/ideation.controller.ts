import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
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
import { IdeationHub } from './ideation.hub';
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

const LIVE_HEARTBEAT_MS = 20_000;
const TYPING_MIN_GAP_MS = 1000;

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
  private readonly lastTyping = new Map<string, number>();

  constructor(
    private readonly ideation: IdeationService,
    private readonly guard: IdeationGuard,
    private readonly hub: IdeationHub,
  ) {}

  @Get(':hackathonId')
  @UseGuards(AiRateLimitGuard)
  async state(@Req() req: any, @Param('hackathonId') hackathonId: string) {
    return this.ideation.getState(req.user.id, hackathonId);
  }

  @Get(':hackathonId/live')
  async live(@Req() req: any, @Res() reply: FastifyReply, @Param('hackathonId') hackathonId: string): Promise<void> {
    const context = await this.ideation.resolveContext(req.user.id, hackathonId);
    const scopes: IdeationScope[] = context.team ? ['team', 'personal'] : ['personal'];
    const raw = this.openEventStream(reply);
    const write = (event: string, data: unknown) => {
      if (!raw.writableEnded) raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const unsubscribers = scopes.map((scope) =>
      this.hub.subscribe(this.ideation.threadId(context, scope), (event, data) => write(event, { scope, ...(data as object) })),
    );
    const heartbeat = setInterval(() => !raw.writableEnded && raw.write(': ping\n\n'), LIVE_HEARTBEAT_MS);
    raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    });
    write('ready', { scopes });
  }

  @Post(':hackathonId/typing')
  @HttpCode(HttpStatus.NO_CONTENT)
  async typing(@Req() req: any, @Param('hackathonId') hackathonId: string): Promise<void> {
    const key = `${hackathonId}:${req.user.id}`;
    const now = Date.now();
    if (now - (this.lastTyping.get(key) ?? 0) < TYPING_MIN_GAP_MS) return;
    this.lastTyping.set(key, now);
    const context = await this.ideation.resolveContext(req.user.id, hackathonId);
    if (!context.team) return;
    this.hub.publish(this.ideation.threadId(context, 'team'), 'typing', { userId: context.userId, name: context.userName });
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
    const threadId = this.ideation.threadId(context, scope);
    const phase = await this.ideation.threadPhase(threadId);
    const raw = this.openEventStream(reply);
    const abort = new AbortController();
    raw.on('close', () => abort.abort());
    const emit: StreamEmitter = (event, data) => {
      if (!raw.writableEnded) raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      if (event === 'stage' || event === 'delta') this.hub.publish(threadId, event, data);
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
      this.hub.publish(threadId, 'settled', {});
      raw.end();
    }
  }

  private openEventStream(reply: FastifyReply) {
    reply.hijack();
    reply.raw.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string | string[] | number>),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    return reply.raw;
  }
}
