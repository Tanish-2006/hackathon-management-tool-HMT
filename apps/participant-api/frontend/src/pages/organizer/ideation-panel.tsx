import { useEffect, useState } from 'react';
import { AlertCircle, Check, CheckCircle2, ChevronRight, Loader2, RotateCcw, Save, Sparkles } from 'lucide-react';
import { organizerApi, OrganizerApiError, type OrganizerIdeationConfig } from '@/services/organizerApi';

type DraftRound = { title: string; goal: string; questionsText: string; exitCriteria: string };
type Draft = { currentRound: number; rounds: DraftRound[]; extraInstructions: string };

const inputClass = 'w-full rounded-xl border border-[#dedbd1] bg-white px-3 py-2 text-sm outline-none focus:border-[#f26a4f] disabled:opacity-60';

function toDraft(config: OrganizerIdeationConfig): Draft {
  return {
    currentRound: config.currentRound,
    rounds: config.rounds.map((r) => ({ title: r.title, goal: r.goal, questionsText: r.questions.join('\n'), exitCriteria: r.exitCriteria })),
    extraInstructions: config.extraInstructions ?? '',
  };
}

function toConfig(draft: Draft, currentRound = draft.currentRound): OrganizerIdeationConfig {
  const extraInstructions = draft.extraInstructions.trim();
  return {
    currentRound,
    rounds: draft.rounds.map((r) => ({
      title: r.title.trim(),
      goal: r.goal.trim(),
      questions: r.questionsText.split('\n').map((q) => q.trim()).filter(Boolean),
      exitCriteria: r.exitCriteria.trim(),
    })),
    ...(extraInstructions ? { extraInstructions } : {}),
  };
}

function validationError(config: OrganizerIdeationConfig): string | null {
  for (const [i, r] of config.rounds.entries()) {
    if (!r.title || !r.goal || !r.exitCriteria) return `Round ${i + 1} needs a title, goal and exit criteria.`;
    if (!r.questions.length) return `Round ${i + 1} needs at least one question.`;
    if (r.questions.length > 12) return `Round ${i + 1} can have at most 12 questions.`;
  }
  return null;
}

export default function IdeationPanel({ hackathonId, status }: { hackathonId: string; status: string }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const readOnly = status === 'ARCHIVED';

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    organizerApi
      .getIdeation(hackathonId)
      .then((config) => {
        if (!mounted) return;
        const next = toDraft(config);
        setDraft(next);
        setSaved(next);
      })
      .catch((e) => mounted && setError(e?.message || 'Failed to load ideation settings'))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [hackathonId]);

  async function save(currentRound?: number) {
    if (!draft || saving) return;
    const config = toConfig(draft, currentRound);
    const invalid = validationError(config);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    setSyncFailed(false);
    const next = { ...draft, currentRound: config.currentRound };
    try {
      await organizerApi.updateIdeation(hackathonId, config);
      setDraft(next);
      setSaved(next);
      setMessage(status === 'PUBLISHED' ? `Saved — participants are now on round ${config.currentRound}.` : 'Saved. Participants receive these settings when the hackathon is published.');
    } catch (e: any) {
      if (e instanceof OrganizerApiError && e.status === 502) {
        setDraft(next);
        setSaved(next);
        setSyncFailed(true);
      } else {
        setError(e?.message || 'Failed to save');
      }
    } finally {
      setSaving(false);
    }
  }

  const updateRound = (index: number, patch: Partial<DraftRound>) =>
    setDraft((d) => (d ? { ...d, rounds: d.rounds.map((r, i) => (i === index ? { ...r, ...patch } : r)) } : d));

  if (loading) return <div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]" />;
  if (!draft) return <div className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700"><AlertCircle size={18} /><div><b>Could not load AI ideation settings</b><p className="mt-1">{error}</p></div></div>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const liveRound = saved?.currentRound ?? 1;
  const nextRound = liveRound < draft.rounds.length ? liveRound + 1 : null;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-[#171a2d] p-6 text-[#fdfbf5]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">AI Helper · round control</div>
            <h2 className="mt-2 text-xl font-bold tracking-[-.03em]">Participants are on round {liveRound}: {saved?.rounds[liveRound - 1]?.title}</h2>
            <p className="mt-1 max-w-xl text-xs leading-5 text-[#9b9fb1]">Every team's AI Helper coaches only inside the current round. Advance when teams are ready — the change reaches participants immediately.</p>
          </div>
          {!readOnly && nextRound && (
            <button onClick={() => save(nextRound)} disabled={saving} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#d8e35b] px-4 py-3 text-xs font-bold text-[#171a2d] disabled:opacity-40">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />} Advance to round {nextRound}
            </button>
          )}
        </div>
        <ol className="mt-5 grid gap-2 sm:grid-cols-5">
          {draft.rounds.map((r, i) => {
            const n = i + 1;
            const selected = draft.currentRound === n;
            return (
              <li key={n}>
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => setDraft({ ...draft, currentRound: n })}
                  aria-pressed={selected}
                  className={`w-full rounded-xl p-3 text-left ${selected ? 'bg-[#f26a4f] text-white' : n < draft.currentRound ? 'bg-[#252941] text-[#d8e35b]' : 'bg-[#252941] text-[#9b9fb1]'}`}
                >
                  <div className="flex items-center gap-1 font-mono text-[10px] uppercase">{n < draft.currentRound && <Check size={11} />}Round {n}</div>
                  <div className="mt-1 text-xs font-bold leading-4">{r.title || 'Untitled'}</div>
                </button>
              </li>
            );
          })}
        </ol>
        {draft.currentRound !== liveRound && <p className="mt-3 text-xs text-[#d8e35b]">Round {draft.currentRound} selected — save to make it live.</p>}
      </div>

      {status !== 'PUBLISHED' && !readOnly && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">This hackathon is not published yet. Settings are saved here and sent to participants when you publish.</div>}
      {readOnly && <div className="rounded-xl border border-[#dedbd1] bg-[#f4f1e8] px-4 py-3 text-xs text-[#55586a]">Archived hackathons are read-only.</div>}
      {message && <div className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 size={16} />{message}</div>}
      {error && <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={16} />{error}</div>}
      {syncFailed && (
        <div className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 sm:flex-row sm:items-center">
          <span className="flex gap-2"><AlertCircle size={16} />Saved, but participants did not receive the update.</span>
          <button onClick={() => save()} disabled={saving} className="inline-flex items-center gap-1 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-bold sm:ml-auto"><RotateCcw size={13} /> Retry sync</button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {draft.rounds.map((r, i) => (
          <div key={i} className={`rounded-2xl border bg-[#fdfbf5] p-5 ${i + 1 === liveRound ? 'border-[#f26a4f]' : 'border-[#dedbd1]'}`}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[.16em] text-[#f26a4f]">Round {i + 1}</span>
              {i + 1 === liveRound && <span className="rounded-full bg-[#d8e35b] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#171a2d]">Live</span>}
            </div>
            <div className="mt-3 space-y-3">
              <label className="block text-xs font-bold text-[#55586a]">Title
                <input value={r.title} maxLength={120} disabled={readOnly} onChange={(e) => updateRound(i, { title: e.target.value })} className={`mt-1 ${inputClass}`} />
              </label>
              <label className="block text-xs font-bold text-[#55586a]">Goal
                <textarea value={r.goal} rows={3} maxLength={1500} disabled={readOnly} onChange={(e) => updateRound(i, { goal: e.target.value })} className={`mt-1 ${inputClass}`} />
              </label>
              <label className="block text-xs font-bold text-[#55586a]">Questions <span className="font-normal text-[#77798a]">(one per line, up to 12)</span>
                <textarea value={r.questionsText} rows={5} disabled={readOnly} onChange={(e) => updateRound(i, { questionsText: e.target.value })} className={`mt-1 ${inputClass}`} />
              </label>
              <label className="block text-xs font-bold text-[#55586a]">Exit criteria
                <textarea value={r.exitCriteria} rows={3} maxLength={1500} disabled={readOnly} onChange={(e) => updateRound(i, { exitCriteria: e.target.value })} className={`mt-1 ${inputClass}`} />
              </label>
            </div>
          </div>
        ))}
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5">
          <div className="flex items-center gap-2 font-bold"><Sparkles size={16} className="text-[#f26a4f]" /> Extra instructions for the AI Helper</div>
          <p className="mt-1 text-xs leading-5 text-[#77798a]">Applied in every round, for every team. For example: focus areas, tone, local context, or things to avoid.</p>
          <textarea value={draft.extraInstructions} rows={8} maxLength={4000} disabled={readOnly} onChange={(e) => setDraft({ ...draft, extraInstructions: e.target.value })} className={`mt-3 ${inputClass}`} />
          <div className="mt-1 text-right font-mono text-[10px] text-[#9b9fb1]">{draft.extraInstructions.length}/4000</div>
        </div>
      </div>

      {!readOnly && (
        <div className="sticky bottom-4 flex justify-end">
          <button onClick={() => save()} disabled={saving || !dirty} className="inline-flex items-center gap-2 rounded-xl bg-[#171a2d] px-5 py-3 text-sm font-bold text-white shadow-lg disabled:opacity-40">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {dirty ? 'Save changes' : 'All changes saved'}
          </button>
        </div>
      )}
    </div>
  );
}
