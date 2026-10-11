import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RotateCcw, Save, Sparkles } from 'lucide-react';
import { organizerApi, OrganizerApiError, type OrganizerIdeationConfig } from '@/services/organizerApi';

type DraftPhase = { title: string; goal: string; questionsText: string; exitCheck: string };
type Draft = { phases: DraftPhase[]; extraInstructions: string };

const MAX_QUESTIONS = 12;
const inputClass = 'w-full rounded-xl border border-[#dedbd1] bg-white px-3 py-2 text-sm outline-none focus:border-[#f26a4f] disabled:opacity-60';

function toDraft(config: OrganizerIdeationConfig): Draft {
  return {
    phases: (config.phases ?? []).map((p) => ({ title: p.title, goal: p.goal, questionsText: p.questions.join('\n'), exitCheck: p.exitCheck })),
    extraInstructions: config.extraInstructions ?? '',
  };
}

function toConfig(draft: Draft): OrganizerIdeationConfig {
  const extraInstructions = draft.extraInstructions.trim();
  return {
    phases: draft.phases.map((p, i) => ({
      id: i + 1,
      title: p.title.trim(),
      goal: p.goal.trim(),
      questions: p.questionsText.split('\n').map((q) => q.trim()).filter(Boolean),
      exitCheck: p.exitCheck.trim(),
    })),
    ...(extraInstructions ? { extraInstructions } : {}),
  };
}

function validationError(config: OrganizerIdeationConfig): string | null {
  for (const [i, p] of config.phases.entries()) {
    if (!p.title || !p.goal || !p.exitCheck) return `Phase ${i + 1} needs a title, goal and exit check.`;
    if (!p.questions.length) return `Phase ${i + 1} needs at least one question.`;
    if (p.questions.length > MAX_QUESTIONS) return `Phase ${i + 1} can have at most ${MAX_QUESTIONS} questions.`;
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

  async function save() {
    if (!draft || saving) return;
    const config = toConfig(draft);
    const invalid = validationError(config);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    setSyncFailed(false);
    try {
      await organizerApi.updateIdeation(hackathonId, config);
      setSaved(draft);
      setMessage(status === 'PUBLISHED' ? 'Saved. The AI coach uses these phases from the next message.' : 'Saved. Participants receive these settings when the hackathon is published.');
    } catch (e: any) {
      if (e instanceof OrganizerApiError && e.status === 502) {
        setSaved(draft);
        setSyncFailed(true);
      } else {
        setError(e?.message || 'Failed to save');
      }
    } finally {
      setSaving(false);
    }
  }

  const updatePhase = (index: number, patch: Partial<DraftPhase>) =>
    setDraft((d) => (d ? { ...d, phases: d.phases.map((p, i) => (i === index ? { ...p, ...patch } : p)) } : d));

  if (loading) return <div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]" />;
  if (!draft) return <div className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700"><AlertCircle size={18} /><div><b>Could not load AI ideation settings</b><p className="mt-1">{error}</p></div></div>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-[#171a2d] p-6 text-[#fdfbf5]">
        <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">AI Helper · coaching phases</div>
        <h2 className="mt-2 text-xl font-bold tracking-[-.03em]">Teams move through {draft.phases.length} phases at their own pace.</h2>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-[#9b9fb1]">
          The coach asks questions inside a team's current phase and moves them forward one step when that phase's exit check holds up, or back to an earlier phase when an answer falls apart. There is no manual advance; edit what each phase asks and checks.
        </p>
        <ol className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {draft.phases.map((p, i) => (
            <li key={i} className="rounded-xl bg-[#252941] p-3">
              <div className="font-mono text-[10px] uppercase text-[#d8e35b]">Phase {i + 1}</div>
              <div className="mt-1 text-xs font-bold leading-4">{p.title || 'Untitled'}</div>
            </li>
          ))}
        </ol>
      </div>

      {status !== 'PUBLISHED' && !readOnly && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">This hackathon is not published yet. Settings are saved here and sent to participants when you publish.</div>}
      {readOnly && <div className="rounded-xl border border-[#dedbd1] bg-[#f4f1e8] px-4 py-3 text-xs text-[#55586a]">Archived hackathons are read-only.</div>}
      {message && <div className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 size={16} />{message}</div>}
      {error && <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={16} />{error}</div>}
      {syncFailed && (
        <div className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 sm:flex-row sm:items-center">
          <span className="flex gap-2"><AlertCircle size={16} />Saved, but participants did not receive the update.</span>
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-bold sm:ml-auto"><RotateCcw size={13} /> Retry sync</button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {draft.phases.map((p, i) => (
          <div key={i} className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5">
            <span className="font-mono text-[10px] uppercase tracking-[.16em] text-[#f26a4f]">Phase {i + 1}</span>
            <div className="mt-3 space-y-3">
              <label className="block text-xs font-bold text-[#55586a]">Title
                <input value={p.title} maxLength={120} disabled={readOnly} onChange={(e) => updatePhase(i, { title: e.target.value })} className={`mt-1 ${inputClass}`} />
              </label>
              <label className="block text-xs font-bold text-[#55586a]">Goal
                <textarea value={p.goal} rows={3} maxLength={1500} disabled={readOnly} onChange={(e) => updatePhase(i, { goal: e.target.value })} className={`mt-1 ${inputClass}`} />
              </label>
              <label className="block text-xs font-bold text-[#55586a]">Questions <span className="font-normal text-[#77798a]">(one per line, up to {MAX_QUESTIONS})</span>
                <textarea value={p.questionsText} rows={5} disabled={readOnly} onChange={(e) => updatePhase(i, { questionsText: e.target.value })} className={`mt-1 ${inputClass}`} />
              </label>
              <label className="block text-xs font-bold text-[#55586a]">Exit check <span className="font-normal text-[#77798a]">(what the coach checks before moving the team on)</span>
                <textarea value={p.exitCheck} rows={3} maxLength={1500} disabled={readOnly} onChange={(e) => updatePhase(i, { exitCheck: e.target.value })} className={`mt-1 ${inputClass}`} />
              </label>
            </div>
          </div>
        ))}
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5">
          <div className="flex items-center gap-2 font-bold"><Sparkles size={16} className="text-[#f26a4f]" /> Extra instructions for the AI Helper</div>
          <p className="mt-1 text-xs leading-5 text-[#77798a]">Applied in every phase, for every team. For example: focus areas, tone, local context, or things to avoid.</p>
          <textarea aria-label="Extra instructions for the AI Helper" value={draft.extraInstructions} rows={8} maxLength={4000} disabled={readOnly} onChange={(e) => setDraft({ ...draft, extraInstructions: e.target.value })} className={`mt-3 ${inputClass}`} />
          <div className="mt-1 text-right font-mono text-[10px] text-[#9b9fb1]">{draft.extraInstructions.length}/4000</div>
        </div>
      </div>

      {!readOnly && (
        <div className="sticky bottom-4 flex justify-end">
          <button onClick={save} disabled={saving || !dirty} className="inline-flex items-center gap-2 rounded-xl bg-[#171a2d] px-5 py-3 text-sm font-bold text-white shadow-lg disabled:opacity-40">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {dirty ? 'Save changes' : 'All changes saved'}
          </button>
        </div>
      )}
    </div>
  );
}
