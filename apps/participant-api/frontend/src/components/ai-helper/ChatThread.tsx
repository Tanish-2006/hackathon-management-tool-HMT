import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, Info } from 'lucide-react';
import type {
  IdeationCard,
  IdeationDeckInfo,
  IdeationMessage,
  IdeationPhase,
  IdeationPhaseChange,
  IdeationScope,
  IdeationSource,
  IdeationStage,
} from '@/services/backendApi';
import { MessageBubble } from '@/components/ai-helper/MessageBubble';
import { SpecialistCard } from '@/components/ai-helper/SpecialistCard';
import { PhaseBanner } from '@/components/ai-helper/PhaseBanner';
import { DeckMessage } from '@/components/ai-helper/DeckMessage';
import { StageIndicator } from '@/components/ai-helper/StageIndicator';

export type LiveTurn = {
  scope: IdeationScope;
  content: string;
  deck: IdeationDeckInfo | null;
  phase: number | null;
  stage: IdeationStage | null;
  card: IdeationCard | null;
  phaseChange: IdeationPhaseChange | null;
  reply: string;
};

export type RemoteTurn = { stage: IdeationStage | null; reply: string };

const PINNED_THRESHOLD_PX = 72;

function Notice({ content }: { content: string }) {
  return (
    <div className="mx-auto flex max-w-lg items-start gap-2 rounded-xl bg-[#f4f1e8] px-3 py-2 text-xs leading-5 text-[#55586a]">
      <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
      <span className="[overflow-wrap:anywhere]">{content}</span>
    </div>
  );
}

function renderMessages(messages: IdeationMessage[], phases: IdeationPhase[], currentUserId: string | null) {
  let sources: IdeationSource[] = [];
  return messages.map((message) => {
    const kind = message.kind ?? (message.role === 'assistant' ? 'assistant' : 'user');
    const mine = !!currentUserId && message.authorId === currentUserId;
    switch (kind) {
      case 'user':
        sources = [];
        return <MessageBubble key={message.id} kind="user" content={message.content} authorName={message.authorName} mine={mine} />;
      case 'deck':
        sources = [];
        return message.deck ? <DeckMessage key={message.id} deck={message.deck} authorName={message.authorName} mine={mine} /> : null;
      case 'card':
        sources = message.card?.sources ?? [];
        return message.card ? <SpecialistCard key={message.id} card={message.card} /> : null;
      case 'phase':
        return message.phaseChange ? <PhaseBanner key={message.id} change={message.phaseChange} phases={phases} /> : null;
      case 'assistant':
        return <MessageBubble key={message.id} kind="assistant" content={message.content} sources={sources} />;
      default:
        return message.content ? <Notice key={message.id} content={message.content} /> : null;
    }
  });
}

export function ChatThread({
  messages,
  phases,
  live,
  remote = null,
  currentUserId,
  currentUserName,
  resetKey,
  emptyState,
}: {
  messages: IdeationMessage[];
  phases: IdeationPhase[];
  live: LiveTurn | null;
  remote?: RemoteTurn | null;
  currentUserId: string | null;
  currentUserName: string | null;
  resetKey: string;
  emptyState: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    setShowJump(false);
  }, []);

  const turnStarted = !!live;
  useLayoutEffect(() => {
    if (turnStarted) scrollToLatest();
  }, [turnStarted, scrollToLatest]);
  useLayoutEffect(scrollToLatest, [resetKey, scrollToLatest]);

  const lastId = messages[messages.length - 1]?.id;
  const contentKey = [messages.length, lastId, live?.reply.length, live?.stage, !!live?.card, !!live?.phaseChange, !!live, remote?.reply.length, remote?.stage].join(':');
  useEffect(() => {
    if (pinnedRef.current) scrollToLatest();
    else setShowJump(true);
  }, [contentKey, scrollToLatest]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < PINNED_THRESHOLD_PX;
    pinnedRef.current = pinned;
    if (pinned) setShowJump(false);
  }

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-label="Conversation with the AI coach"
        aria-busy={!!live}
        tabIndex={0}
        className="h-[58vh] min-h-[340px] space-y-4 overflow-y-auto overflow-x-hidden p-3 outline-none focus-visible:ring-2 focus-visible:ring-[#f26a4f]/40 sm:p-4"
      >
        {messages.length === 0 && !live && !remote && emptyState}
        {renderMessages(messages, phases, currentUserId)}
        {live && (
          <>
            {live.deck ? (
              <DeckMessage deck={live.deck} authorName={currentUserName} mine />
            ) : (
              <MessageBubble kind="user" content={live.content} authorName={currentUserName} mine />
            )}
            {live.card && <SpecialistCard card={live.card} />}
            {live.phaseChange && <PhaseBanner change={live.phaseChange} phases={phases} />}
            {live.reply ? (
              <MessageBubble kind="assistant" content={live.reply} sources={live.card?.sources} streaming />
            ) : (
              <StageIndicator stage={live.stage} />
            )}
          </>
        )}
        {!live && remote && (
          remote.reply ? (
            <MessageBubble kind="assistant" content={remote.reply} streaming />
          ) : (
            <StageIndicator stage={remote.stage} />
          )
        )}
      </div>
      {showJump && (
        <button
          type="button"
          onClick={scrollToLatest}
          className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[#171a2d] px-3 py-1.5 text-xs font-bold text-[#fdfbf5] shadow-lg"
        >
          <ArrowDown size={13} aria-hidden /> Jump to latest
        </button>
      )}
    </div>
  );
}
