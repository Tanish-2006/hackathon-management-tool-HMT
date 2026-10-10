import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { AlertCircle, Check, Loader2, Lock, Send, Sparkles, User, Users, X } from 'lucide-react';
import { ApiError, hmtBackendService, streamIdeationMessage, type IdeationMessage, type IdeationScope, type IdeationState } from '@/services/backendApi';
import { useHackathonContext } from '@/hooks/use-hackathon-context';
import { useAuth } from '@/services/auth-context';

const POLL_INTERVAL_MS = 15000;
const MAX_LENGTH = 4000;

type PendingTurn = { scope: IdeationScope; content: string; reply: string };

function friendly(e: unknown) {
  return e instanceof ApiError ? e.message : (e as Error)?.message || 'Something went wrong';
}

function RoundStepper({ state }: { state: IdeationState }) {
  const current = state.currentRound;
  const round = state.ideation.rounds[current - 1];
  return (
    <div className="space-y-3">
      <ol className="grid gap-2 sm:grid-cols-5">
        {state.ideation.rounds.map((r, i) => {
          const n = i + 1;
          const status = n < current ? 'done' : n === current ? 'current' : 'locked';
          return (
            <li
              key={n}
              aria-current={status === 'current' ? 'step' : undefined}
              className={`rounded-xl border p-3 ${status === 'current' ? 'border-[#f26a4f] bg-white shadow-sm' : status === 'done' ? 'border-[#dedbd1] bg-[#f4f1e8]' : 'border-dashed border-[#dedbd1] bg-transparent opacity-60'}`}
            >
              <div className="flex items-center gap-2">
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${status === 'current' ? 'bg-[#f26a4f] text-white' : status === 'done' ? 'bg-[#d8e35b] text-[#171a2d]' : 'bg-[#e9e5da] text-[#77798a]'}`}>
                  {status === 'done' ? <Check size={13} /> : status === 'locked' ? <Lock size={11} /> : n}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-[#77798a]">Round {n}</span>
              </div>
              <div className="mt-2 text-xs font-bold leading-4 text-[#171a2d]">{r.title}</div>
            </li>
          );
        })}
      </ol>
      {round && (
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-4">
          <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#f26a4f]">Now · Round {current} · {round.title}</div>
          <p className="mt-2 text-sm leading-6 text-[#171a2d]">{round.goal}</p>
          <details className="mt-2 text-xs text-[#55586a]">
            <summary className="cursor-pointer font-bold text-[#171a2d]">Questions to work through and how this round ends</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 leading-5">
              {round.questions.map((q) => <li key={q}>{q}</li>)}
            </ul>
            <p className="mt-2 leading-5"><b>Exit criteria:</b> {round.exitCriteria}</p>
          </details>
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message, mine, showAuthor }: { message: Pick<IdeationMessage, 'role' | 'content' | 'round' | 'authorName'>; mine: boolean; showAuthor: boolean }) {
  const assistant = message.role === 'assistant';
  return (
    <div className={`flex ${assistant || !mine ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 ${assistant ? 'border border-[#e5e1d7] bg-white text-[#171a2d]' : mine ? 'bg-[#171a2d] text-[#fdfbf5]' : 'bg-[#f4f1e8] text-[#171a2d]'}`}>
        <div className={`mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider ${assistant ? 'text-[#f26a4f]' : mine ? 'text-[#d8e35b]' : 'text-[#77798a]'}`}>
          {assistant ? <><Sparkles size={11} /> AI Helper</> : showAuthor ? message.authorName || 'Teammate' : 'You'}
          <span className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] ${mine && !assistant ? 'bg-[#252941] text-[#d8e35b]' : 'bg-[#e9e5da] text-[#77798a]'}`}>R{message.round}</span>
        </div>
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
      </div>
    </div>
  );
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
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const pendingRef = useRef(false);

  const load = useCallback(async (silent: boolean) => {
    if (!hackathonId) return;
    if (!silent) setLoading(true);
    try {
      const next = await hmtBackendService.getIdeation(hackathonId);
      setState(next);
      setLoadError(null);
      setScope((prev) => prev ?? (next.team ? 'team' : 'personal'));
    } catch (e) {
      if (!silent) {
        setState(null);
        setLoadError(friendly(e));
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [hackathonId]);

  useEffect(() => {
    setState(null);
    setScope(null);
    setLoadError(null);
    if (!hackathonId || !ctx.selectedIsRegistered) return;
    load(false);
    const timer = setInterval(() => {
      if (!pendingRef.current && !document.hidden) load(true);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hackathonId, ctx.selectedIsRegistered, load]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const activeScope: IdeationScope = scope ?? 'personal';
  const thread = activeScope === 'team' ? state?.teamThread ?? [] : state?.personalThread ?? [];
  const pendingHere = pending && pending.scope === activeScope ? pending : null;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length, pendingHere?.reply, activeScope]);

  async function send() {
    const content = draft.trim();
    if (!hackathonId || !content || pending) return;
    const controller = new AbortController();
    abortRef.current = controller;
    pendingRef.current = true;
    setDraft('');
    setSendError(null);
    setPending({ scope: activeScope, content, reply: '' });
    try {
      await streamIdeationMessage(
        hackathonId,
        { scope: activeScope, content },
        (event) => {
          if (event.event === 'delta') setPending((prev) => (prev ? { ...prev, reply: prev.reply + event.data.text } : prev));
          if (event.event === 'error') setSendError(event.data.message);
        },
        controller.signal,
      );
      await load(true);
    } catch (e) {
      if (!controller.signal.aborted) {
        setSendError(friendly(e));
        setDraft(content);
      }
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  }

  const header = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">AI Helper{state?.hackathon.title ? ` · ${state.hackathon.title}` : ''}</div>
        <h1 className="mt-2 text-3xl font-bold tracking-[-.05em] text-[#171a2d]">Incubate your idea, round by round.</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[#77798a]">A coach that asks the hard questions instead of handing you answers. Your organizer opens each round; work through it with your team, or think privately first.</p>
      </div>
    </div>
  );

  const picker = (
    <div className="flex flex-col gap-2 rounded-2xl border border-[#dedbd1] bg-[#f4f1e8] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      {ctx.loading ? (
        <span className="text-xs text-[#77798a]">Loading hackathon context…</span>
      ) : !hackathonId ? (
        <span className="text-xs text-[#55586a]">Register for a hackathon to unlock the AI Helper. <Link href="/participant/hackathons" className="font-bold underline">Discover hackathons</Link></span>
      ) : (
        <>
          <label className="flex items-center gap-2 text-xs font-semibold text-[#55586a]">Hackathon
            <select
              value={hackathonId}
              onChange={(e) => ctx.select(e.target.value || null)}
              className="rounded-lg border border-[#dedbd1] bg-white px-2 py-1.5 text-xs font-bold text-[#171a2d] outline-none focus:border-[#f26a4f]"
              aria-label="Select hackathon"
            >
              {ctx.options.map((o) => <option key={o.id} value={o.id}>{o.title}{o.registered ? '' : ' (not registered)'}</option>)}
            </select>
          </label>
          {!ctx.selectedIsRegistered && (
            <span className="text-xs text-[#55586a]">Not registered here — <Link href="/participant/hackathons" className="font-bold underline">register in Discover</Link> to use the AI Helper.</span>
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
        <div className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          <AlertCircle size={18} />
          <div><b>AI Helper is not available</b><p className="mt-1">{loadError}</p><button onClick={() => load(false)} className="mt-3 text-xs font-bold underline">Try again</button></div>
        </div>
      );
    } else if (state) {
      const teamLocked = activeScope === 'team' && !state.team;
      body = (
        <div className="space-y-5">
          <RoundStepper state={state} />
          {!state.configured && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">AI Helper isn't configured yet — ask the organizer. You can still write down your thinking; messages are saved.</div>
          )}
          <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5]">
            <div className="flex items-center gap-1 border-b border-[#e5e1d7] p-2" role="tablist">
              {([['team', 'Team', Users], ['personal', 'Personal', User]] as const).map(([value, label, Icon]) => (
                <button
                  key={value}
                  role="tab"
                  aria-selected={activeScope === value}
                  onClick={() => setScope(value)}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold ${activeScope === value ? 'bg-[#171a2d] text-white' : 'text-[#55586a] hover:bg-[#f4f1e8]'}`}
                >
                  <Icon size={14} /> {label}
                  {value === 'team' && state.team && <span className="font-normal opacity-70">· {state.team.name}</span>}
                </button>
              ))}
              <span className="ml-auto hidden pr-2 text-[11px] text-[#77798a] sm:inline">
                {activeScope === 'team' ? (state.team ? `Shared with ${state.team.members.map((m) => m.name).join(', ')}` : '') : 'Only you can see this thread'}
              </span>
            </div>
            {teamLocked ? (
              <div className="p-8 text-center">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#171a2d] text-[#d8e35b]"><Users size={22} /></div>
                <h2 className="mt-4 text-lg font-bold">Join a team first</h2>
                <p className="mt-2 text-sm leading-6 text-[#77798a]">The team thread is shared by everyone on your team. Create or join one, or use your personal thread meanwhile.</p>
                <div className="mt-5 flex justify-center gap-2">
                  <Link href="/participant/teams" className="rounded-xl bg-[#f26a4f] px-4 py-2 text-xs font-bold text-white">Go to My Team</Link>
                  <button onClick={() => setScope('personal')} className="rounded-xl border border-[#dedbd1] px-4 py-2 text-xs font-bold">Use personal thread</button>
                </div>
              </div>
            ) : (
              <>
                <div ref={listRef} className="h-[52vh] min-h-[320px] space-y-3 overflow-y-auto p-4" aria-live="polite">
                  {thread.length === 0 && !pendingHere && (
                    <div className="mx-auto mt-10 max-w-md text-center text-sm leading-6 text-[#77798a]">
                      <Sparkles size={20} className="mx-auto mb-2 text-[#f26a4f]" />
                      Start with what you have, even if it is rough. For round {state.currentRound}, tell the AI Helper what you are thinking about {state.ideation.rounds[state.currentRound - 1]?.title.toLowerCase()}.
                    </div>
                  )}
                  {thread.map((m) => (
                    <MessageBubble key={m.id} message={m} mine={m.role === 'user' && (!!user?.id && m.authorId === user.id)} showAuthor={activeScope === 'team'} />
                  ))}
                  {pendingHere && (
                    <>
                      <MessageBubble message={{ role: 'user', content: pendingHere.content, round: state.currentRound, authorName: null }} mine showAuthor={false} />
                      <div className="flex justify-start">
                        <div className="max-w-[85%] rounded-2xl border border-[#e5e1d7] bg-white px-4 py-3 text-sm leading-6 text-[#171a2d]">
                          <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[#f26a4f]"><Sparkles size={11} /> AI Helper</div>
                          {pendingHere.reply ? <div className="whitespace-pre-wrap break-words">{pendingHere.reply}</div> : <span className="inline-flex items-center gap-2 text-xs text-[#77798a]"><Loader2 size={13} className="animate-spin" /> Thinking…</span>}
                        </div>
                      </div>
                    </>
                  )}
                </div>
                {sendError && (
                  <div className="mx-4 mb-2 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    <AlertCircle size={14} className="mt-0.5" />{sendError}
                    <button onClick={() => setSendError(null)} className="ml-auto" aria-label="Dismiss"><X size={13} /></button>
                  </div>
                )}
                <form
                  className="flex items-end gap-2 border-t border-[#e5e1d7] p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    send();
                  }}
                >
                  <div className="flex-1">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value.slice(0, MAX_LENGTH))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          send();
                        }
                      }}
                      rows={3}
                      placeholder={activeScope === 'team' ? 'Share with your team and the AI Helper… (Shift+Enter for a new line)' : 'Think out loud privately… (Shift+Enter for a new line)'}
                      className="w-full resize-none rounded-xl border border-[#dedbd1] bg-white px-3 py-2 text-sm outline-none focus:border-[#f26a4f]"
                      aria-label="Message the AI Helper"
                    />
                    <div className="mt-1 text-right font-mono text-[10px] text-[#9b9fb1]">{draft.length}/{MAX_LENGTH}</div>
                  </div>
                  <button type="submit" disabled={!draft.trim() || !!pending} className="mb-5 inline-flex items-center gap-2 rounded-xl bg-[#f26a4f] px-4 py-3 text-xs font-bold text-white disabled:opacity-40">
                    {pending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      );
    }
  }

  return (
    <div className="space-y-6">
      {header}
      {picker}
      {body}
    </div>
  );
}
