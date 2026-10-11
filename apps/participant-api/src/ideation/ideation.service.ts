import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { defaultIdeationConfig, ideationConfigSchema, type IdeationConfig } from '@hmt/contracts';
import { PrismaService } from '../database/prisma.service';
import { AsiOneClient } from './asi-one.client';
import { IdeationRouter, type PhaseMove, type Specialist } from './ideation.router';
import { IdeationHub } from './ideation.hub';
import { MarketGapAnalyst, ResearchScout } from './ideation.sources';
import {
  CoachPrompt,
  type IdeationHackathon,
  type IdeationScope,
  type IdeationTeam,
  type SpecialistBrief,
} from './ideation.prompt';

export type { IdeationScope, IdeationTeam, IdeationHackathon } from './ideation.prompt';

export type MessageKind = 'user' | 'assistant' | 'card' | 'phase' | 'deck' | 'notice';

export interface IdeationCard {
  specialist: Exclude<Specialist, 'none'>;
  title: string;
  sources: Array<{ title: string; url: string; meta: string }>;
}

export interface IdeationMessage {
  id: string;
  kind: MessageKind;
  role: 'user' | 'assistant' | 'system';
  content: string;
  authorId: string | null;
  authorName: string | null;
  phase: number;
  createdAt: Date;
  card?: IdeationCard;
  phaseChange?: { from: number; to: number; reason: string };
  deck?: { fileName: string; slideCount: number };
}

export interface PhaseHistoryEntry {
  phase: number;
  at: Date;
  reason: string;
}

export interface IdeationThread {
  id: string;
  phase: number;
  phaseHistory: PhaseHistoryEntry[];
  messages: IdeationMessage[];
}

export interface IdeationContext {
  userId: string;
  userName: string;
  hackathon: IdeationHackathon;
  config: IdeationConfig;
  team: IdeationTeam | null;
}

export interface DeckSlide {
  index: number;
  title: string;
  text: string;
}

export interface SendResult {
  userMessageId: string;
  assistantMessageId: string | null;
  phase: number;
}

export type StreamEmitter = (event: string, data: unknown) => void;

export const MAX_MESSAGE_CHARS = 4000;
export const MAX_DECK_SLIDES = 60;
export const MAX_DECK_CHARS = 24_000;
const DECK_PHASE = 6;
const THREAD_VIEW_LIMIT = 200;
const ROUTER_HISTORY = 8;

const CARD_TITLES: Record<IdeationCard['specialist'], string> = {
  research: 'Research Scout',
  market: 'Market Gap Analyst',
  devil: "Devil's Advocate",
  users: 'User Voice',
};

@Injectable()
export class IdeationService {
  private readonly threadLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly asi: AsiOneClient,
    private readonly router: IdeationRouter,
    private readonly scout: ResearchScout,
    private readonly market: MarketGapAnalyst,
    private readonly hub: IdeationHub,
  ) {}

  async resolveContext(userId: string, hackathonId: string): Promise<IdeationContext> {
    const hackathon: any = await this.prisma.hackathon.findUnique({
      where: { id: hackathonId },
    } as any);
    if (!hackathon) throw new NotFoundException('Hackathon not found');
    const status = hackathon.status ?? (hackathon.isPublished ? 'PUBLISHED' : 'DRAFT');
    if (status !== 'PUBLISHED')
      throw new ForbiddenException('AI Helper is available only while the hackathon is published');
    const [registration, user, team] = await Promise.all([
      (this.prisma as any).registration.findFirst({ where: { userId, hackathonId } }),
      this.prisma.user.findUnique({ where: { id: userId } } as any),
      this.findTeam(userId, hackathonId),
    ]);
    if (!registration)
      throw new ForbiddenException('Register for this hackathon to use the AI Helper');
    const parsed = ideationConfigSchema.safeParse(hackathon.ideation);
    return {
      userId,
      userName: this.displayName(user),
      hackathon,
      config: parsed.success ? parsed.data : defaultIdeationConfig(),
      team,
    };
  }

  requireScope(context: IdeationContext, scope: IdeationScope): void {
    if (scope === 'team' && !context.team)
      throw new ForbiddenException('Join a team to use the shared team thread');
  }

  threadId(context: IdeationContext, scope: IdeationScope): string {
    return scope === 'team'
      ? `ideation:${context.hackathon.id}:team:${context.team!.id}`
      : `ideation:${context.hackathon.id}:user:${context.userId}`;
  }

  async threadPhase(threadId: string): Promise<number> {
    const conversation: any = await this.prisma.aiConversation.findUnique({
      where: { id: threadId },
    } as any);
    return this.clampPhase(conversation?.phase);
  }

  async getState(userId: string, hackathonId: string) {
    const context = await this.resolveContext(userId, hackathonId);
    const [teamThread, personalThread] = await Promise.all([
      context.team ? this.loadThread(this.threadId(context, 'team')) : Promise.resolve(null),
      this.loadThread(this.threadId(context, 'personal')),
    ]);
    return {
      hackathon: { id: context.hackathon.id, title: context.hackathon.title },
      phases: context.config.phases,
      extraInstructions: context.config.extraInstructions ?? '',
      team: context.team,
      teamThread,
      personalThread,
      limits: { maxChars: MAX_MESSAGE_CHARS },
    };
  }

  async assertDeckAllowed(
    context: IdeationContext,
    scope: IdeationScope,
    slides: DeckSlide[],
  ): Promise<void> {
    if (slides.length > MAX_DECK_SLIDES)
      throw new BadRequestException(`A deck can have at most ${MAX_DECK_SLIDES} slides`);
    const chars = slides.reduce((sum, slide) => sum + slide.title.length + slide.text.length, 0);
    if (chars > MAX_DECK_CHARS)
      throw new BadRequestException(
        `The deck text is too long (${chars} characters, max ${MAX_DECK_CHARS}). Remove speaker notes or split it.`,
      );
    if ((await this.threadPhase(this.threadId(context, scope))) !== DECK_PHASE)
      throw new ConflictException(
        'Deck review opens in phase 6 (Pitch & deck). Keep working through the earlier phases first.',
      );
  }

  async send(
    context: IdeationContext,
    scope: IdeationScope,
    content: string,
    emit: StreamEmitter,
    signal?: AbortSignal,
  ): Promise<SendResult> {
    const threadId = this.threadId(context, scope);
    return this.withThreadLock(threadId, async () => {
      const conversation = await this.ensureConversation(threadId, context, scope);
      const history = await this.listMessages(threadId);
      const phase = this.clampPhase(conversation.phase);
      const userMessage = await this.store(threadId, {
        kind: 'user',
        role: 'user',
        content,
        phase,
        authorId: context.userId,
        authorName: context.userName,
      });
      emit('stage', { name: 'routing' });
      const verdict = await this.router.decide(
        {
          phase,
          phases: context.config.phases,
          history: history
            .filter((m) => m.kind === 'user' || m.kind === 'assistant')
            .slice(-ROUTER_HISTORY)
            .map((m) => ({
              role: m.kind === 'assistant' ? 'assistant' : 'user',
              content: m.content,
            })),
          content,
        },
        signal,
      );
      let brief: SpecialistBrief | null = null;
      if (verdict.specialist !== 'none') {
        emit('stage', { name: verdict.specialist });
        brief = await this.consult(
          verdict.specialist,
          verdict.query || content.slice(0, 200),
          context,
          scope,
          signal,
        );
        const card = this.toCard(brief);
        const stored = await this.store(threadId, {
          kind: 'card',
          role: 'system',
          content: card.title,
          phase,
          authorId: null,
          authorName: card.title,
          card,
        });
        emit('card', { id: stored.id, ...card });
      }
      const move = IdeationRouter.nextPhase(phase, verdict);
      const nextPhase = await this.applyMove(threadId, conversation, move, verdict.reason, emit);
      emit('stage', { name: 'writing' });
      const messages = CoachPrompt.build({
        hackathon: context.hackathon,
        config: context.config,
        scope,
        team: context.team,
        participantName: context.userName,
        phase: nextPhase,
        move,
        history,
        brief,
        offTopic: verdict.offTopic,
        turn: { content, authorName: context.userName },
        deckReview: false,
      });
      const assistantMessageId = await this.streamReply(
        threadId,
        messages,
        nextPhase,
        emit,
        signal,
      );
      return { userMessageId: userMessage.id, assistantMessageId, phase: nextPhase };
    });
  }

  async reviewDeck(
    context: IdeationContext,
    scope: IdeationScope,
    fileName: string,
    slides: DeckSlide[],
    emit: StreamEmitter,
    signal?: AbortSignal,
  ): Promise<SendResult> {
    const threadId = this.threadId(context, scope);
    return this.withThreadLock(threadId, async () => {
      const conversation = await this.ensureConversation(threadId, context, scope);
      const history = await this.listMessages(threadId);
      const phase = this.clampPhase(conversation.phase);
      emit('stage', { name: 'reading' });
      const ordered = [...slides].sort((a, b) => a.index - b.index);
      const content = ordered
        .map((slide) => {
          const body = [slide.title.trim(), slide.text.trim()].filter(Boolean).join('\n');
          return `Slide ${slide.index}:\n${body || '(no text)'}`;
        })
        .join('\n\n');
      const deckMessage = await this.store(threadId, {
        kind: 'deck',
        role: 'user',
        content,
        phase,
        authorId: context.userId,
        authorName: context.userName,
        deck: { fileName, slideCount: slides.length },
      });
      emit('stage', { name: 'writing' });
      const messages = CoachPrompt.build({
        hackathon: context.hackathon,
        config: context.config,
        scope,
        team: context.team,
        participantName: context.userName,
        phase,
        move: null,
        history,
        brief: null,
        offTopic: false,
        turn: {
          content: `Here is the text of our deck "${fileName}" (${slides.length} slides):\n\n${content}`,
          authorName: context.userName,
        },
        deckReview: true,
      });
      const assistantMessageId = await this.streamReply(threadId, messages, phase, emit, signal);
      return { userMessageId: deckMessage.id, assistantMessageId, phase };
    });
  }

  private async consult(
    specialist: Exclude<Specialist, 'none'>,
    query: string,
    context: IdeationContext,
    scope: IdeationScope,
    signal?: AbortSignal,
  ): Promise<SpecialistBrief> {
    if (specialist === 'research')
      return { specialist, sources: await this.scout.search(query, signal), verified: true };
    if (specialist === 'market') {
      const owner = scope === 'team' ? `team:${context.team!.id}` : `user:${context.userId}`;
      return { specialist, ...(await this.market.search(query, owner, signal)) };
    }
    return { specialist, sources: [], verified: true };
  }

  private toCard(brief: SpecialistBrief): IdeationCard {
    const specialist = brief.specialist as IdeationCard['specialist'];
    const unverified = specialist === 'market' && !brief.verified;
    return {
      specialist,
      title: unverified
        ? `${CARD_TITLES.market} · unverified, no live search`
        : CARD_TITLES[specialist],
      sources: brief.sources.map(({ title, url, meta }) => ({ title, url, meta })),
    };
  }

  private async applyMove(
    threadId: string,
    conversation: any,
    move: PhaseMove | null,
    note: string,
    emit: StreamEmitter,
  ): Promise<number> {
    if (!move) {
      await this.prisma.aiConversation.update({
        where: { id: threadId },
        data: { lastRouterNote: note },
      } as any);
      return this.clampPhase(conversation.phase);
    }
    const at = new Date();
    await this.prisma.aiConversation.update({
      where: { id: threadId },
      data: {
        phase: move.to,
        phaseHistory: [
          ...(conversation.phaseHistory ?? []),
          { phase: move.to, at, reason: move.reason },
        ],
        lastRouterNote: note,
      },
    } as any);
    await this.store(threadId, {
      kind: 'phase',
      role: 'system',
      content: move.reason,
      phase: move.to,
      authorId: null,
      authorName: null,
      phaseChange: move,
    });
    emit('phase', move);
    return move.to;
  }

  private async streamReply(
    threadId: string,
    messages: ReturnType<typeof CoachPrompt.build>,
    phase: number,
    emit: StreamEmitter,
    signal?: AbortSignal,
  ): Promise<string | null> {
    let reply = '';
    let savedId: string | null = null;
    try {
      for await (const delta of this.asi.stream(messages, signal)) {
        reply += delta;
        emit('delta', { text: delta });
      }
    } finally {
      if (reply.trim()) {
        const saved = await this.store(threadId, {
          kind: this.asi.configured ? 'assistant' : 'notice',
          role: this.asi.configured ? 'assistant' : 'system',
          content: reply,
          phase,
          authorId: null,
          authorName: 'AI Coach',
        });
        savedId = saved.id;
      }
    }
    return savedId;
  }

  private async store(
    conversationId: string,
    data: Omit<IdeationMessage, 'id' | 'createdAt'>,
  ): Promise<IdeationMessage> {
    const row = await this.prisma.aiMessage.create({ data: { conversationId, ...data } } as any);
    const message = this.toMessage(row);
    this.hub.publish(conversationId, 'message', message);
    return message;
  }

  private async ensureConversation(
    id: string,
    context: IdeationContext,
    scope: IdeationScope,
  ): Promise<any> {
    const existing = await this.prisma.aiConversation.findUnique({ where: { id } } as any);
    if (existing) return existing;
    return this.prisma.aiConversation.create({
      data: {
        id,
        kind: 'IDEATION',
        scope,
        hackathonId: context.hackathon.id,
        teamId: scope === 'team' ? context.team!.id : null,
        userId: scope === 'personal' ? context.userId : null,
        title: scope === 'team' ? `AI Helper · ${context.team!.name}` : 'AI Helper · personal',
        phase: 1,
        phaseHistory: [{ phase: 1, at: new Date(), reason: 'Started' }],
        lastRouterNote: null,
      },
    } as any);
  }

  private async loadThread(id: string): Promise<IdeationThread> {
    const [conversation, messages]: [any, IdeationMessage[]] = await Promise.all([
      this.prisma.aiConversation.findUnique({ where: { id } } as any),
      this.listMessages(id),
    ]);
    return {
      id,
      phase: this.clampPhase(conversation?.phase),
      phaseHistory: conversation?.phaseHistory ?? [],
      messages: messages.slice(-THREAD_VIEW_LIMIT),
    };
  }

  private async listMessages(conversationId: string): Promise<IdeationMessage[]> {
    const rows: any[] = await this.prisma.aiMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    } as any);
    return rows.map((row) => this.toMessage(row));
  }

  private toMessage(row: any): IdeationMessage {
    const kind: MessageKind = row.kind ?? (row.role === 'assistant' ? 'assistant' : 'user');
    return {
      id: row.id,
      kind,
      role: row.role === 'assistant' || row.role === 'system' ? row.role : 'user',
      content: row.content,
      authorId: row.authorId ?? null,
      authorName: row.authorName ?? null,
      phase: this.clampPhase(row.phase ?? row.round),
      createdAt: row.createdAt,
      ...(row.card ? { card: row.card } : {}),
      ...(row.phaseChange ? { phaseChange: row.phaseChange } : {}),
      ...(row.deck ? { deck: row.deck } : {}),
    };
  }

  private clampPhase(value: unknown): number {
    const phase = Number(value);
    return Number.isInteger(phase) && phase >= 1 && phase <= 6 ? phase : 1;
  }

  private async findTeam(userId: string, hackathonId: string): Promise<IdeationTeam | null> {
    const memberships: any[] = await this.prisma.teamMember.findMany({ where: { userId } } as any);
    const teams = await Promise.all(
      memberships.map((m) => this.prisma.team.findUnique({ where: { id: m.teamId } } as any)),
    );
    const team: any = teams.find((t: any) => t && String(t.hackathonId) === String(hackathonId));
    if (!team) return null;
    const [members, project]: [any[], any] = await Promise.all([
      this.prisma.teamMember.findMany({ where: { teamId: team.id }, include: { user: true } } as any),
      this.prisma.project.findUnique({ where: { teamId: team.id } } as any),
    ]);
    return {
      id: team.id,
      name: team.name,
      members: members.map((m) => ({ id: m.userId, name: this.displayName(m.user) })),
      project: project
        ? { title: project.title, description: project.description, problemStatement: project.problemStatement, techStack: project.techStack }
        : null,
    };
  }

  private displayName(user: any): string {
    return user?.fullName || user?.name || user?.email?.split('@')[0] || 'Participant';
  }

  private async withThreadLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.threadLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => current);
    this.threadLocks.set(key, tail);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.threadLocks.get(key) === tail) this.threadLocks.delete(key);
    }
  }
}
