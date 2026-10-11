import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'wouter';
import { AlertCircle, Sparkles, User, Users, X } from 'lucide-react';
import {
  ApiError,
  hmtBackendService,
  retryAfterSeconds,
  streamDeckReview,
  streamIdeationMessage,
  watchIdeation,
  notifyIdeationTyping,
  type IdeationDeckSlide,
  type IdeationLiveEvent,
  type IdeationMessage,
  type IdeationScope,
  type IdeationState,
  type IdeationStreamEvent,
} from '@/services/backendApi';
import { useHackathonContext } from '@/hooks/use-hackathon-context';
import { displayNameOf, useAuth } from '@/services/auth-context';
import { cn } from '@/lib/utils';
import { PhaseProgress } from '@/components/ai-helper/PhaseProgress';
import { ChatThread, type LiveTurn, type RemoteTurn } from '@/components/ai-helper/ChatThread';
import { Composer, useCountdown } from '@/components/ai-helper/Composer';
import { DeckUpload } from '@/components/ai-helper/DeckUpload';

const POLL_INTERVAL_MS = 15000;
const RECONNECT_MAX_MS = 15000;
const TYPING_PING_MS = 2500;
const TYPING_VISIBLE_MS = 4000;
const DEFAULT_MAX_CHARS = 4000;
const DECK_PHASE = 6;
const SCOPES: Array<{ value: IdeationScope; label: string; Icon: typeof Users }> = [
  { value: 'team', label: 'Team', Icon: Users },
  { value: 'personal', label: 'Personal', Icon: User },
];

type StreamStarter = (onEvent: (event: IdeationStreamEvent) => void, signal: AbortSignal) => Promise<void>;

function friendly(e: unknown) {
  return e instanceof ApiError ? e.message : (e as Error)?.message || 'Something went wrong';
}

function threadKey(scope: IdeationScope) {
  return scope === 'team' ? 'teamThread' : 'personalThread';
}

function withMessage(state: IdeationState, scope: IdeationScope, message: IdeationMessage): IdeationState {
  const key = threadKey(scope);
  const thread = state[key];
  if (!thread || thread.messages.some((m) => m.id === message.id)) return state;
  const messages = [...thread.messages, message].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const phase = message.kind === 'phase' && message.phaseChange ? message.phaseChange.to : thread.phase;
  return { ...state, [key]: { ...thread, phase, messages } };
}

function mergeState(next: IdeationState, prev: IdeationState | null): IdeationState {
  if (!prev) return next;
  let merged = next;
  for (const scope of ['team', 'personal'] as const) {
    for (const message of prev[threadKey(scope)]?.messages ?? []) merged = withMessage(merged, scope, message);
  }
  return merged;
}

function waitFor(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

function applyStreamEvent(turn: LiveTurn, event: IdeationStreamEvent): LiveTurn {
  switch (event.event) {
    case 'start':
      return { ...turn, phase: event.data.phase };
    case 'stage':
      return { ...turn, stage: event.data.name };
    case 'card':
      return { ...turn, card: event.data };
    case 'phase':
      return { ...turn, phaseChange: event.data, phase: event.data.to };
    case 'delta':
      return { ...turn, reply: turn.reply + event.data.text };
    case 'done':
      return { ...turn, phase: event.data.phase };
    default:
      return turn;
  }
}

export default function ParticipantAIHelper() {
  const ctx = useHackathonContext();
  const { user } = useAuth();
  const hackathonId = ctx.selectedId;
  const [state, setState] = useState<IdeationState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<IdeationScope | null>(null);
  const [draft, setDraft] = useState('');
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const cooldownSeconds = useCountdown(cooldownUntil);
  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);
  const liveScopeRef = useRef<IdeationScope | null>(null);
  const connectedRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [remote, setRemote] = useState<Record<IdeationScope, RemoteTurn | null>>({ team: null, personal: null });
  const [typers, setTypers] = useState<Record<string, { name: string; until: number }>>({});
  const lastTypingPingRef = useRef(0);
  const epochRef = useRef(0);

  const load = useCallback(async (silent: boolean) => {
    if (!hackathonId) return;
    const epoch = epochRef.current;
    if (!silent) setLoading(true);
    try {
      const next = await hmtBackendService.getIdeation(hackathonId);
      if (epoch !== epochRef.current || (silent && streamingRef.current)) return;
      setState((prev) => mergeState(next, silent ? prev : null));
      setLoadError(null);
      setScope((prev) => prev ?? (next.team ? 'team' : 'personal'));
    } catch (e) {
      if (!silent && epoch === epochRef.current) {
        setState(null);
        setLoadError(friendly(e));
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [hackathonId]);

  useEffect(() => {
    epochRef.current += 1;
    abortRef.current?.abort();
    setState(null);
    setScope(null);
    setLive(null);
    setLoadError(null);
    setError(null);
    if (!hackathonId || !ctx.selectedIsRegistered) return;
    load(false);
    const timer = setInterval(() => {
      if (!streamingRef.current && !document.hidden && !connectedRef.current) load(true);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hackathonId, ctx.selectedIsRegistered, load]);

  const onLive = useCallback((event: IdeationLiveEvent) => {
    if (event.event === 'ready') return;
    if (event.event === 'typing') {
      if (event.data.userId !== user?.id) setTypers((t) => ({ ...t, [event.data.userId]: { name: event.data.name, until: Date.now() + TYPING_VISIBLE_MS } }));
      return;
    }
    if (event.event === 'message' && event.data.authorId) {
      const authorId = event.data.authorId;
      setTypers((t) => {
        if (!(authorId in t)) return t;
        const { [authorId]: _gone, ...rest } = t;
        return rest;
      });
    }
    const { scope } = event.data;
    if (streamingRef.current && liveScopeRef.current === scope) return;
    if (event.event === 'message') {
      const { scope: _scope, ...message } = event.data;
      setState((prev) => (prev ? withMessage(prev, scope, message) : prev));
      if (message.kind === 'assistant') setRemote((r) => ({ ...r, [scope]: null }));
    } else if (event.event === 'stage') {
      setRemote((r) => ({ ...r, [scope]: { stage: event.data.name, reply: r[scope]?.reply ?? '' } }));
    } else if (event.event === 'delta') {
      setRemote((r) => ({ ...r, [scope]: { stage: r[scope]?.stage ?? 'writing', reply: (r[scope]?.reply ?? '') + event.data.text } }));
    } else if (event.event === 'settled') {
      setRemote((r) => ({ ...r, [scope]: null }));
      load(true);
    }
  }, [load, user?.id]);

  const typingActive = Object.keys(typers).length > 0;
  useEffect(() => {
    if (!typingActive) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setTypers((t) => {
        const live = Object.entries(t).filter(([, v]) => v.until > now);
        return live.length === Object.keys(t).length ? t : Object.fromEntries(live);
      });
    }, 500);
    return () => clearInterval(timer);
  }, [typingActive]);

  function changeDraft(value: string) {
    setDraft(value);
    const now = Date.now();
    if (hackathonId && activeScope === 'team' && state?.team && value.trim() && now - lastTypingPingRef.current > TYPING_PING_MS) {
      lastTypingPingRef.current = now;
      notifyIdeationTyping(hackathonId);
    }
  }

  useEffect(() => {
    if (!hackathonId || !ctx.selectedIsRegistered) return;
    const controller = new AbortController();
    const setOnline = (online: boolean) => {
      connectedRef.current = online;
      setConnected(online);
    };
    (async () => {
      for (let attempt = 0; !controller.signal.aborted; attempt += 1) {
        try {
          await watchIdeation(hackathonId, (event) => {
            if (event.event === 'ready') {
              if (attempt > 0) load(true);
              attempt = 0;
              setOnline(true);
            }
            onLive(event);
          }, controller.signal);
        } catch {}
        setOnline(false);
        setRemote({ team: null, personal: null });
        await waitFor(Math.min(1000 * 2 ** attempt, RECONNECT_MAX_MS), controller.signal);
      }
    })();
    return () => {
      controller.abort();
      setOnline(false);
    };
  }, [hackathonId, ctx.selectedIsRegistered, load, onLive]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const activeScope: IdeationScope = scope ?? 'personal';
  const thread = state ? (activeScope === 'team' ? state.teamThread : state.personalThread) : null;
  const liveHere = live && live.scope === activeScope ? live : null;
  const phase = liveHere?.phase ?? thread?.phase ?? 1;
  const streaming = !!live;
  const maxChars = state?.limits?.maxChars || DEFAULT_MAX_CHARS;
  const userName = displayNameOf(user) || null;

  async function runTurn(turn: Pick<LiveTurn, 'content' | 'deck'>, start: StreamStarter, onRejected: () => void) {
    if (!hackathonId || streamingRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    streamingRef.current = true;
    liveScopeRef.current = activeScope;
    setRemote((r) => ({ ...r, [activeScope]: null }));
    epochRef.current += 1;
    const epoch = epochRef.current;
    let accepted = false;
    setError(null);
    setLive({ ...turn, scope: activeScope, phase: null, stage: null, card: null, phaseChange: null, reply: '' });
    try {
      await start((event) => {
        accepted = true;
        if (event.event === 'error') {
          setError(event.data.message);
          if (event.data.retryAfter) setCooldownUntil(Date.now() + event.data.retryAfter * 1000);
          return;
        }
        setLive((prev) => (prev ? applyStreamEvent(prev, event) : prev));
      }, controller.signal);
    } catch (e) {
      if (controller.signal.aborted) return;
      const wait = retryAfterSeconds(e);
      if (wait) setCooldownUntil(Date.now() + wait * 1000);
      setError(friendly(e));
      if (!accepted) onRejected();
    } finally {
      if (!controller.signal.aborted) {
        if (accepted) {
          try {
            const next = await hmtBackendService.getIdeation(hackathonId);
            if (epoch === epochRef.current) setState((prev) => mergeState(next, prev));
          } catch {}
        }
        if (epoch === epochRef.current) setLive(null);
      }
      if (abortRef.current === controller) {
        abortRef.current = null;
        streamingRef.current = false;
      }
    }
  }

  function send() {
    const content = draft.trim();
    if (!content || !hackathonId || cooldownSeconds > 0) return;
    const sendScope = activeScope;
    setDraft('');
    runTurn(
      { content, deck: null },
      (onEvent, signal) => streamIdeationMessage(hackathonId, { scope: sendScope, content }, onEvent, signal),
      () => setDraft(content),
    );
  }

  function uploadDeck(fileName: string, slides: IdeationDeckSlide[]) {
    if (!hackathonId || cooldownSeconds > 0) return;
    const sendScope = activeScope;
    runTurn(
      { content: '', deck: { fileName, slideCount: slides.length } },
      (onEvent, signal) => streamDeckReview(hackathonId, { scope: sendScope, fileName, slides }, onEvent, signal),
      () => {},
    );
  }

  function handleTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const index = SCOPES.findIndex((s) => s.value === activeScope);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? SCOPES.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + SCOPES.length) % SCOPES.length;
    setScope(SCOPES[next].value);
    document.getElementById(`ai-helper-tab-${SCOPES[next].value}`)?.focus();
  }

  const title = state?.hackathon.title ?? ctx.selectedTitle;
  const header = (
    <div>
      <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">AI Helper{title ? ` · ${title}` : ''}</div>
      <h1 className="mt-2 text-2xl font-bold tracking-[-.05em] text-[#171a2d] sm:text-3xl">Sharpen your idea, phase by phase.</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#77798a]">
        A coach that asks hard, honest questions and challenges claims with real papers and real competitors. It never writes the idea for you. Move on when your answers hold up.
      </p>
    </div>
  );

  const needsPicker = ctx.loading || !hackathonId || ctx.options.length > 1 || !ctx.selectedIsRegistered;
  const picker = needsPicker && (
    <div className="flex flex-col gap-2 rounded-2xl border border-[#dedbd1] bg-[#f4f1e8] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      {ctx.loading ? (
        <span className="text-xs text-[#77798a]">Loading your event…</span>
      ) : !hackathonId ? (
        <span className="text-xs text-[#55586a]">Register for an event to unlock the AI Helper. <Link href="/participant/hackathons" className="font-bold underline">Discover hackathons</Link></span>
      ) : (
        <>
          {ctx.options.length > 1 && (
            <label className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[#55586a]">
              Event
              <select
                value={hackathonId}
                onChange={(e) => ctx.select(e.target.value || null)}
                className="min-w-0 max-w-full rounded-lg border border-[#dedbd1] bg-white px-2 py-1.5 text-xs font-bold text-[#171a2d] outline-none focus:border-[#f26a4f]"
              >
                {ctx.options.map((o) => <option key={o.id} value={o.id}>{o.title}{o.registered ? '' : ' (not registered)'}</option>)}
              </select>
            </label>
          )}
          {!ctx.selectedIsRegistered && (
            <span className="text-xs text-[#55586a]">Not registered here. <Link href="/participant/hackathons" className="font-bold underline">Register in Discover</Link> to use the AI Helper.</span>
          )}
        </>
      )}
    </div>
  );

  let body: React.ReactNode = null;
  if (hackathonId && ctx.selectedIsRegistered) {
    if (loading && !state) {
      body = <div className="space-y-4"><div className="h-24 animate-pulse rounded-2xl bg-[#e9e5da]" /><div className="h-80 animate-pulse rounded-2xl bg-[#e9e5da]" /></div>;
    } else if (loadError) {
      body = (
        <div role="alert" className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          <AlertCircle size={18} className="shrink-0" aria-hidden />
          <div><b>AI Helper is not available</b><p className="mt-1">{loadError}</p><button onClick={() => load(false)} className="mt-3 text-xs font-bold underline">Try again</button></div>
        </div>
      );
    } else if (state) {
      const teamLocked = activeScope === 'team' && !state.teamThread;
      const currentPhase = state.phases[phase - 1];
      body = (
        <div className="space-y-5">
          <PhaseProgress phases={state.phases} current={phase} />
          <div className="overflow-hidden rounded-2xl border border-[#dedbd1] bg-[#fdfbf5]">
            <div className="flex flex-wrap items-center gap-1 border-b border-[#e5e1d7] p-2">
              <div role="tablist" aria-label="Conversation" className="flex gap-1">
                {SCOPES.map(({ value, label, Icon }) => (
                  <button
                    key={value}
                    id={`ai-helper-tab-${value}`}
                    role="tab"
                    type="button"
                    aria-selected={activeScope === value}
                    aria-controls="ai-helper-panel"
                    tabIndex={activeScope === value ? 0 : -1}
                    onClick={() => setScope(value)}
                    onKeyDown={handleTabKey}
                    className={cn('inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold', activeScope === value ? 'bg-[#171a2d] text-white' : 'text-[#55586a] hover:bg-[#f4f1e8]')}
                  >
                    <Icon size={14} aria-hidden /> {label}
                  </button>
                ))}
              </div>
              <span className="ml-auto truncate px-2 text-[11px] text-[#77798a]">
                {activeScope === 'team' ? (state.team ? `${state.team.name} · shared with your team` : '') : 'Only you can see this thread'}
              </span>
              <span className={cn('mr-1 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider', connected ? 'bg-[#e8f5e9] text-[#2e7d32]' : 'bg-[#f4f1e8] text-[#77798a]')} title={connected ? 'New messages appear instantly' : 'Reconnecting… messages refresh every few seconds'} data-testid="status-live">
                <span className={cn('h-1.5 w-1.5 rounded-full', connected ? 'animate-pulse bg-[#2e7d32]' : 'bg-[#aaa9a2]')} aria-hidden />
                {connected ? 'Live' : 'Offline'}
              </span>
            </div>
            <div id="ai-helper-panel" role="tabpanel" aria-labelledby={`ai-helper-tab-${activeScope}`}>
              {teamLocked ? (
                <div className="p-8 text-center">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#171a2d] text-[#d8e35b]"><Users size={22} aria-hidden /></div>
                  <h2 className="mt-4 text-lg font-bold">Join a team first</h2>
                  <p className="mt-2 text-sm leading-6 text-[#77798a]">The team thread is shared by everyone on your team. Create or join one, or think privately in your personal thread meanwhile.</p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    <Link href="/participant/teams" className="rounded-xl bg-[#f26a4f] px-4 py-2 text-xs font-bold text-white">Go to My Team</Link>
                    <button type="button" onClick={() => setScope('personal')} className="rounded-xl border border-[#dedbd1] px-4 py-2 text-xs font-bold">Use personal thread</button>
                  </div>
                </div>
              ) : (
                <>
                  <ChatThread
                    messages={thread?.messages ?? []}
                    phases={state.phases}
                    live={liveHere}
                    remote={liveHere ? null : remote[activeScope]}
                    typing={activeScope === 'team' ? Object.values(typers).map((t) => t.name) : []}
                    currentUserId={user?.id ?? null}
                    currentUserName={userName}
                    resetKey={`${hackathonId}:${activeScope}`}
                    emptyState={
                      <div className="mx-auto mt-10 max-w-md text-center text-sm leading-6 text-[#77798a]">
                        <Sparkles size={20} className="mx-auto mb-2 text-[#f26a4f]" aria-hidden />
                        Start with what you have, even if it is rough.
                        {currentPhase?.questions?.[0] && <span className="mt-2 block font-semibold text-[#171a2d]">“{currentPhase.questions[0]}”</span>}
                      </div>
                    }
                  />
                  {error && (
                    <div role="alert" className="mx-3 mb-1 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{error}</span>
                      <button type="button" onClick={() => setError(null)} className="shrink-0" aria-label="Dismiss error"><X size={13} aria-hidden /></button>
                    </div>
                  )}
                  <Composer
                    value={draft}
                    onChange={changeDraft}
                    onSubmit={send}
                    maxChars={maxChars}
                    streaming={streaming}
                    cooldownSeconds={cooldownSeconds}
                    placeholder={activeScope === 'team' ? 'Share with your team and the coach…' : 'Think out loud privately…'}
                  >
                    {phase === DECK_PHASE && <DeckUpload disabled={streaming || cooldownSeconds > 0} onDeck={uploadDeck} onError={setError} />}
                  </Composer>
                </>
              )}
            </div>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      {header}
      {picker}
      {body}
    </div>
  );
}
