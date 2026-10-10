import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Loader2, RefreshCw, Pencil, Rocket, Save, ShieldCheck, Sparkles } from 'lucide-react';
import { organizerApi, OrganizerApiError } from '@/services/organizerApi';

type WizardType = 'PROBLEM_STATEMENT_BASED' | 'OPEN_INNOVATION' | 'HYBRID';

const ELIGIBILITY = ['Students', 'Developers', 'Designers', 'Professionals', 'Anyone'] as const;

const PROV_TONE: Record<string, string> = {
  AI_GENERATED: 'bg-[#e9e5da] text-[#77798a]',
  ORGANIZER_EDITED: 'bg-[#5aafbd] text-white',
  AI_REGENERATED: 'bg-[#d8e35b] text-[#171a2d]',
};

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="block text-sm font-semibold">{label}{required && <span className="ml-1 text-[#f26a4f]">*</span>}<div className="mt-1.5">{children}</div></label>;
}

function SectionCard({ title, provenance, onEdit, editing, onRegen, regenLoading, children }: {
  title: string; provenance?: string; onEdit: () => void; editing: boolean; onRegen: () => void; regenLoading: boolean; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[#dedbd1] bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-bold">{title}</h3>
        {provenance && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${PROV_TONE[provenance] || PROV_TONE.AI_GENERATED}`}>{provenance.replace('_', ' ')}</span>}
        <div className="ml-auto flex gap-2">
          <button onClick={onEdit} className="inline-flex items-center gap-1 rounded-lg border border-[#dedbd1] px-2.5 py-1.5 text-[11px] font-bold hover:bg-[#f4f1e8]" data-testid={`button-edit-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`}><Pencil size={12} /> {editing ? 'Close' : 'Edit'}</button>
          <button onClick={onRegen} disabled={regenLoading} className="inline-flex items-center gap-1 rounded-lg border border-[#dedbd1] px-2.5 py-1.5 text-[11px] font-bold text-[#f26a4f] hover:bg-[#fff6f3] disabled:opacity-50" data-testid={`button-regen-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`}>{regenLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Regenerate</button>
        </div>
      </div>
      <div className="mt-3 text-sm leading-6">{children}</div>
    </div>
  );
}

export default function OrganizerQuickCreate() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);
  const [regenKey, setRegenKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 5 questions
  const [mode, setMode] = useState<'ONLINE' | 'OFFLINE' | 'HYBRID'>('HYBRID');
  const [about, setAbout] = useState('');
  const [hackathonType, setHackathonType] = useState<WizardType>('OPEN_INNOVATION');
  const [eligibility, setEligibility] = useState<string[]>(['Anyone']);
  const [customEligibility, setCustomEligibility] = useState('');
  const [durationPlus, setDurationPlus] = useState('');

  const [hackathon, setHackathon] = useState<any | null>(null);
  const [draft, setDraft] = useState<any | null>(null);
  const [phases, setPhases] = useState<any[]>([]);
  const [criteria, setCriteria] = useState<any[]>([]);
  const [resources, setResources] = useState<any[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const hackathonId = hackathon?.id as string | undefined;
  const provenance = useMemo(() => (hackathon?.metadata?.sectionProvenance || {}) as Record<string, string>, [hackathon]);

  // Resume: /organizer/hackathons/quick-create?id=<id> loads server draft (never localStorage).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const h = await organizerApi.getHackathon(id);
        setHackathon(h);
        setDraft((h.metadata as any)?.draft || null);
        const [p, c, r] = await Promise.all([
          organizerApi.listPhases(id).catch(() => []),
          organizerApi.listCriteria(id).catch(() => []),
          organizerApi.listResources(id).catch(() => []),
        ]);
        setPhases(p); setCriteria(c); setResources(r);
        setStep(2);
        setSuccess('Draft loaded — continue editing.');
      } catch (e: any) {
        setError(e.message || 'Could not load draft');
      } finally { setLoading(false); }
    })();
  }, []);

  const canGenerate = about.trim().length >= 3 && durationPlus.trim().length >= 1 && eligibility.length >= 1;

  async function refreshLists(id: string) {
    const [p, c, r] = await Promise.all([
      organizerApi.listPhases(id).catch(() => []),
      organizerApi.listCriteria(id).catch(() => []),
      organizerApi.listResources(id).catch(() => []),
    ]);
    setPhases(p); setCriteria(c); setResources(r);
  }

  async function handleGenerate() {
    if (!canGenerate) { setError('Answer all 5 questions first.'); return; }
    setLoading(true); setError(null); setSuccess(null);
    try {
      const res = await organizerApi.generateWizard({
        mode, about: about.trim(), hackathonType, eligibility,
        customEligibility: customEligibility.trim() || null, durationPlus: durationPlus.trim(),
      });
      setHackathon(res.hackathon); setDraft(res.draft);
      await refreshLists(res.hackathon.id);
      setStep(2);
      setSuccess('Your hackathon is ready. Review every section — AI never publishes.');
    } catch (e: any) {
      setError(e instanceof OrganizerApiError ? e.message : (e.message || 'Generation failed'));
    } finally { setLoading(false); }
  }

  function startEdit(key: string, current: string) {
    setEditing(key); setEditValue(current);
  }

  async function saveEdit(patch: Record<string, any>, sectionKey: string) {
    if (!hackathonId) return;
    setLoading(true); setError(null);
    try {
      const updated = await organizerApi.updateHackathon(hackathonId, patch);
      setHackathon(updated);
      setDraft((updated.metadata as any)?.draft || null);
      setEditing(null);
      setSuccess(`Saved — ${sectionKey} marked ORGANIZER_EDITED. Your edits override AI content.`);
    } catch (e: any) {
      setError(e.message || 'Save failed');
    } finally { setLoading(false); }
  }

  async function regen(section: string) {
    if (!hackathonId) return;
    setRegenKey(section); setError(null);
    try {
      const res = await organizerApi.regenerateSection(hackathonId, section);
      setHackathon(res.hackathon);
      setDraft((res.hackathon.metadata as any)?.draft || null);
      await refreshLists(hackathonId);
      setSuccess(`Regenerated ${section} only — everything else untouched.`);
    } catch (e: any) {
      setError(e.message || 'Regeneration failed');
    } finally { setRegenKey(null); }
  }

  async function saveDraftAndExit() {
    if (!hackathonId) return;
    setSuccess('Draft saved. Leave anytime — return from the hackathon list to continue.');
    setLocation('/organizer/hackathons');
  }

  async function transition(target: 'review' | 'confirm' | 'publish') {
    if (!hackathonId) return;
    setLoading(true); setError(null);
    try {
      const res = target === 'review' ? await organizerApi.transitionReview(hackathonId)
        : target === 'confirm' ? await organizerApi.transitionConfirm(hackathonId)
        : await organizerApi.transitionPublish(hackathonId);
      const updated = (res as any).hackathon || res;
      setHackathon(updated);
      setSuccess(`Transition to ${updated.status} successful`);
    } catch (e: any) {
      setError(e.message || 'Transition failed');
    } finally { setLoading(false); }
  }

  const toggleEligibility = (v: string) => {
    setEligibility((prev) => {
      if (v === 'Anyone') return prev.includes('Anyone') ? [] : ['Anyone'];
      const withoutAnyone = prev.filter((x) => x !== 'Anyone');
      return withoutAnyone.includes(v) ? withoutAnyone.filter((x) => x !== v) : [...withoutAnyone, v];
    });
  };

  const listText = (v: unknown): string => Array.isArray(v) ? (v as any[]).join('\n') : String(v ?? '');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/organizer/hackathons" className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] p-2"><ArrowLeft size={16} /></Link>
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">Organizer · AI quick create</div>
          <h1 className="text-2xl font-bold tracking-[-.04em]">Let&apos;s create your hackathon.</h1>
          <p className="text-xs text-[#77798a]">Answer 5 questions — AI drafts the rest. Review → Confirm → Publish. AI never auto-publishes.</p>
        </div>
        {hackathon && <span className="ml-auto rounded-full bg-[#d8e35b] px-2.5 py-1 text-[10px] font-bold text-[#171a2d]">{hackathon.status}</span>}
      </div>

      <div className="flex gap-2">
        {(['Questions', 'Review', 'Confirm & Publish'] as const).map((label, i) => (
          <div key={label} className={`flex-1 rounded-xl px-3 py-2 text-center text-xs font-bold ${step === i + 1 ? 'bg-[#171a2d] text-white' : 'bg-[#f4f1e8] text-[#77798a]'}`}>{i + 1}. {label}</div>
        ))}
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{error}</span><button onClick={() => setError(null)} className="ml-auto text-xs font-bold">Dismiss</button></div>}
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 flex gap-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0" /><span>{success}</span><button onClick={() => setSuccess(null)} className="ml-auto text-xs font-bold">Dismiss</button></div>}

      {step === 1 && (
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6 sm:p-8">
          <div className="space-y-6">
            <div>
              <div className="text-sm font-semibold">1. Hackathon mode</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {(['ONLINE', 'OFFLINE', 'HYBRID'] as const).map((m) => (
                  <button key={m} onClick={() => setMode(m)} className={`rounded-xl border p-4 text-left ${mode === m ? 'border-[#f26a4f] bg-[#fff6f3]' : 'border-[#e5e1d7] bg-white hover:border-[#f26a4f]/40'}`} data-testid={`button-mode-${m.toLowerCase()}`}>
                    <div className="font-bold text-sm">{m.charAt(0) + m.slice(1).toLowerCase()}</div>
                    <div className="mt-1 text-[11px] leading-4 text-[#77798a]">{m === 'ONLINE' ? 'Fully virtual' : m === 'OFFLINE' ? 'In person' : 'Both tracks'}</div>
                  </button>
                ))}
              </div>
            </div>
            <Field label="2. What is the hackathon about?" required>
              <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={3} placeholder="e.g. AI for Education" className="hmt-input resize-none" data-testid="input-wizard-about" />
            </Field>
            <div>
              <div className="text-sm font-semibold">3. Hackathon type</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {([
                  { id: 'PROBLEM_STATEMENT_BASED', title: 'Problem Statements', desc: 'Concrete challenges to solve' },
                  { id: 'OPEN_INNOVATION', title: 'Open Innovation', desc: 'Broad theme, free direction' },
                  { id: 'HYBRID', title: 'Hybrid', desc: 'Problem tracks + open exploration' },
                ] as { id: WizardType; title: string; desc: string }[]).map((t) => (
                  <button key={t.id} onClick={() => setHackathonType(t.id)} className={`rounded-xl border p-4 text-left ${hackathonType === t.id ? 'border-[#f26a4f] bg-[#fff6f3]' : 'border-[#e5e1d7] bg-white hover:border-[#f26a4f]/40'}`} data-testid={`button-type-${t.id.toLowerCase()}`}>
                    <div className="font-bold text-sm">{t.title}</div>
                    <div className="mt-1 text-[11px] leading-4 text-[#77798a]">{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-sm font-semibold">4. Who can participate?</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {ELIGIBILITY.map((e) => (
                  <button key={e} onClick={() => toggleEligibility(e)} className={`rounded-lg border px-3 py-2 text-xs font-bold ${eligibility.includes(e) ? 'border-[#171a2d] bg-[#171a2d] text-white' : 'border-[#e5e1d7] bg-white hover:border-[#171a2d]/40'}`} data-testid={`button-eligibility-${e.toLowerCase()}`}>{e}</button>
                ))}
              </div>
              <input value={customEligibility} onChange={(e) => setCustomEligibility(e.target.value)} placeholder="Custom group (optional)" className="hmt-input mt-2" data-testid="input-custom-eligibility" />
            </div>
            <Field label="5. Duration + additional requirements" required>
              <textarea value={durationPlus} onChange={(e) => setDurationPlus(e.target.value)} rows={4} placeholder={'3 days\nReact, Python welcome\nPrizes: $500 best prototype\nJudging prefers live demos'} className="hmt-input resize-none" data-testid="input-wizard-duration" />
            </Field>
            <button onClick={handleGenerate} disabled={loading || !canGenerate} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#f26a4f] px-4 py-3.5 text-sm font-bold text-white disabled:opacity-50" data-testid="button-generate-hackathon">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Generate Hackathon
            </button>
          </div>
        </div>
      )}

      {step === 2 && hackathon && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-[#171a2d] p-6 text-[#fdfbf5]">
            <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">Your hackathon is ready.</div>
            <h2 className="mt-2 text-2xl font-bold">{hackathon.title}</h2>
            <p className="mt-1 text-sm text-[#b9bdca]">{draft?.tagline || hackathon.description}</p>
          </div>
          <SectionCard title="Overview" provenance={provenance.description} editing={editing === 'overview'} onEdit={() => (editing === 'overview' ? setEditing(null) : startEdit('overview', `${hackathon.title}\n${draft?.tagline || ''}\n${hackathon.description}`))} onRegen={() => regen('description')} regenLoading={regenKey === 'description'}>
            {editing === 'overview' ? (
              <div className="space-y-2">
                <textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} rows={5} className="hmt-input resize-none" />
                <button onClick={() => { const [t, ...rest] = editValue.split('\n'); void saveEdit({ title: t || hackathon.title, description: rest.join('\n') }, 'overview'); }} disabled={loading} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Save overview</button>
              </div>
            ) : (<><div className="font-bold">{hackathon.title}</div><div className="text-[#77798a]">{hackathon.description}</div></>)}
          </SectionCard>
          <SectionCard title="Theme" provenance={provenance.theme} editing={editing === 'theme'} onEdit={() => (editing === 'theme' ? setEditing(null) : startEdit('theme', String(draft?.theme || '')))} onRegen={() => regen('theme')} regenLoading={regenKey === 'theme'}>
            {editing === 'theme' ? (
              <div className="space-y-2"><input value={editValue} onChange={(e) => setEditValue(e.target.value)} className="hmt-input" /><button onClick={() => void saveEdit({ theme: editValue }, 'theme')} disabled={loading} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Save theme</button></div>
            ) : (<span>{String(draft?.theme || '—')}</span>)}
          </SectionCard>
          <SectionCard title="Participation Mode" provenance={provenance.participationInstructions} editing={editing === 'participationInstructions'} onEdit={() => (editing === 'participationInstructions' ? setEditing(null) : startEdit('participationInstructions', String(draft?.participationInstructions || '')))} onRegen={() => regen('participationInstructions')} regenLoading={regenKey === 'participationInstructions'}>
            {editing === 'participationInstructions' ? (
              <div className="space-y-2"><textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} rows={3} className="hmt-input resize-none" /><button onClick={() => void saveEdit({ participationInstructions: editValue }, 'participation')} disabled={loading} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Save</button></div>
            ) : (<><div className="text-xs font-bold">{hackathon.mode}</div><div className="text-[#77798a]">{String(draft?.participationInstructions || '—')}</div></>)}
          </SectionCard>
          {(hackathon.hackathonType === 'PROBLEM_STATEMENT_BASED' || hackathon.hackathonType === 'HYBRID') && (
            <SectionCard title="Problem Statements" provenance={provenance.problemStatements} editing={editing === 'problemStatements'} onEdit={() => (editing === 'problemStatements' ? setEditing(null) : startEdit('problemStatements', listText(draft?.problemStatements)))} onRegen={() => regen('problemStatements')} regenLoading={regenKey === 'problemStatements'}>
              {editing === 'problemStatements' ? (
                <div className="space-y-2"><textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} rows={4} className="hmt-input resize-none" /><button onClick={() => void saveEdit({ problemStatements: editValue.split('\n').map((s) => s.trim()).filter(Boolean), problemStatement: editValue.split('\n').map((s) => s.trim()).filter(Boolean)[0] || null }, 'problems')} disabled={loading} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Save</button></div>
              ) : (<ul className="list-disc space-y-1 pl-5 text-[#33353f]">{((draft?.problemStatements || []) as string[]).map((p: string, i: number) => <li key={i}>{p}</li>)}{(!draft?.problemStatements?.length) && <li className="text-[#77798a]">No problem statements yet.</li>}</ul>)}
            </SectionCard>
          )}
          {(hackathon.hackathonType === 'OPEN_INNOVATION' || hackathon.hackathonType === 'HYBRID') && (
            <SectionCard title="Open Innovation" provenance={provenance.openInnovation} editing={editing === 'openInnovation'} onEdit={() => (editing === 'openInnovation' ? setEditing(null) : startEdit('openInnovation', listText(draft?.openInnovation?.guidelines)))} onRegen={() => regen('openInnovation')} regenLoading={regenKey === 'openInnovation'}>
              {editing === 'openInnovation' ? (
                <div className="space-y-2"><textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} rows={4} className="hmt-input resize-none" /><button onClick={() => void saveEdit({ openInnovation: { guidelines: editValue.split('\n').map((s) => s.trim()).filter(Boolean) } }, 'open innovation')} disabled={loading} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Save</button></div>
              ) : (<ul className="list-disc space-y-1 pl-5 text-[#33353f]">{((draft?.openInnovation?.guidelines || []) as string[]).map((g: string, i: number) => <li key={i}>{g}</li>)}</ul>)}
            </SectionCard>
          )}
          <SectionCard title="Eligibility & Team" provenance={provenance.eligibility} editing={editing === 'eligibility'} onEdit={() => (editing === 'eligibility' ? setEditing(null) : startEdit('eligibility', listText(draft?.eligibility)))} onRegen={() => regen('eligibility')} regenLoading={regenKey === 'eligibility'}>
            {editing === 'eligibility' ? (
              <div className="space-y-2"><textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} rows={3} className="hmt-input resize-none" /><button onClick={() => void saveEdit({ eligibility: editValue.split('\n').map((s) => s.trim()).filter(Boolean) }, 'eligibility')} disabled={loading} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Save</button></div>
            ) : (<><div>{((draft?.eligibility || []) as string[]).join(' · ') || hackathon.audience}</div><div className="mt-1 text-xs text-[#77798a]">Team: {draft?.teamSize?.min || 1}–{draft?.teamSize?.max || 4} (recommended {draft?.teamSize?.recommended || 3})</div></>)}
          </SectionCard>
          <SectionCard title="Rules" provenance={provenance.rules} editing={editing === 'rules'} onEdit={() => (editing === 'rules' ? setEditing(null) : startEdit('rules', listText(hackathon.rules)))} onRegen={() => regen('rules')} regenLoading={regenKey === 'rules'}>
            {editing === 'rules' ? (
              <div className="space-y-2"><textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} rows={4} className="hmt-input resize-none" /><button onClick={() => void saveEdit({ rules: editValue.split('\n').map((s) => s.trim()).filter(Boolean) }, 'rules')} disabled={loading} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Save rules</button></div>
            ) : (<ul className="list-disc space-y-1 pl-5 text-[#33353f]">{(hackathon.rules || []).map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>)}
          </SectionCard>
          <SectionCard title="Timeline" provenance={provenance.timeline} editing={false} onEdit={() => setLocation(hackathonId ? `/organizer/hackathons/${hackathonId}` : '/organizer/hackathons')} onRegen={() => regen('timeline')} regenLoading={regenKey === 'timeline'}>
            <ul className="space-y-1">{phases.map((p: any) => <li key={p.id} className="flex justify-between text-xs"><span><b>#{p.order} {p.name}</b> — {p.description}</span><span className="whitespace-nowrap font-mono text-[#77798a]">{new Date(p.startsAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} → {new Date(p.endsAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></li>)}{!phases.length && <li className="text-[#77798a]">No phases.</li>}</ul>
          </SectionCard>
          <SectionCard title="Evaluation Criteria" provenance={provenance.evaluationCriteria} editing={false} onEdit={() => setLocation(hackathonId ? `/organizer/hackathons/${hackathonId}` : '/organizer/hackathons')} onRegen={() => regen('evaluationCriteria')} regenLoading={regenKey === 'evaluationCriteria'}>
            <ul className="space-y-1">{criteria.map((c: any) => <li key={c.id} className="text-xs"><b>{c.name}</b> · weight {c.weight} · max {c.maxScore}</li>)}{!criteria.length && <li className="text-[#77798a]">No criteria.</li>}</ul>
          </SectionCard>
          <SectionCard title="Resources" provenance={provenance.resources} editing={false} onEdit={() => setLocation(hackathonId ? `/organizer/hackathons/${hackathonId}` : '/organizer/hackathons')} onRegen={() => regen('resources')} regenLoading={regenKey === 'resources'}>
            <ul className="space-y-1">{resources.map((r: any) => <li key={r.id} className="text-xs"><b>{r.title}</b> · {r.type}</li>)}{!resources.length && <li className="text-[#77798a]">No resources.</li>}</ul>
          </SectionCard>
          <SectionCard title="FAQs" provenance={provenance.faqs} editing={editing === 'faqs'} onEdit={() => (editing === 'faqs' ? setEditing(null) : startEdit('faqs', ((draft?.faqs || []) as any[]).map((f) => `${f.question} | ${f.answer}`).join('\n')))} onRegen={() => regen('faqs')} regenLoading={regenKey === 'faqs'}>
            {editing === 'faqs' ? (
              <div className="space-y-2"><textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} rows={4} className="hmt-input resize-none" /><button onClick={() => void saveEdit({ faqs: editValue.split('\n').map((s) => s.trim()).filter(Boolean).map((l) => { const [question, ...rest] = l.split('|'); return { question: (question || '').trim(), answer: rest.join('|').trim() }; }).filter((f) => f.question) }, 'faqs')} disabled={loading} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Save</button></div>
            ) : (<div className="space-y-2">{((draft?.faqs || []) as any[]).map((f: any, i: number) => <div key={i}><b className="text-xs">{f.question}</b><p className="text-xs text-[#77798a]">{f.answer}</p></div>)}</div>)}
          </SectionCard>
          <SectionCard title="Prizes" provenance={provenance.prizes} editing={editing === 'prizes'} onEdit={() => (editing === 'prizes' ? setEditing(null) : startEdit('prizes', ((draft?.prizes || []) as any[]).map((p) => `${p.title} | ${p.description}`).join('\n')))} onRegen={() => regen('prizes')} regenLoading={regenKey === 'prizes'}>
            {editing === 'prizes' ? (
              <div className="space-y-2"><textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} rows={3} className="hmt-input resize-none" /><button onClick={() => void saveEdit({ prizes: editValue.split('\n').map((s) => s.trim()).filter(Boolean).map((l) => { const [title, ...rest] = l.split('|'); return { title: (title || '').trim(), description: rest.join('|').trim() }; }).filter((p) => p.title) }, 'prizes')} disabled={loading} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Save</button></div>
            ) : (<div className="space-y-1">{((draft?.prizes || []) as any[]).map((p: any, i: number) => <div key={i} className="text-xs"><b>{p.title}</b> — {p.description}</div>)}{!(draft?.prizes?.length) && <div className="text-xs text-[#77798a]">No prizes configured — add them if the organizer provided prize info.</div>}</div>)}
          </SectionCard>
          <SectionCard title="Announcement" provenance={provenance.announcement} editing={editing === 'announcement'} onEdit={() => (editing === 'announcement' ? setEditing(null) : startEdit('announcement', String(draft?.announcement || '')))} onRegen={() => regen('announcement')} regenLoading={regenKey === 'announcement'}>
            {editing === 'announcement' ? (
              <div className="space-y-2"><textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} rows={4} className="hmt-input resize-none" /><button onClick={() => void saveEdit({ announcement: editValue }, 'announcement')} disabled={loading} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Save</button></div>
            ) : (<p className="text-[#33353f]">{String(draft?.announcement || '—')}</p>)}
          </SectionCard>
          <div className="flex flex-wrap gap-2">
            <button onClick={saveDraftAndExit} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-[#dedbd1] bg-[#fdfbf5] px-4 py-3 text-xs font-bold disabled:opacity-50" data-testid="button-save-draft"><Save size={14} /> Save Draft</button>
            <button onClick={() => setStep(3)} className="inline-flex items-center gap-2 rounded-xl bg-[#171a2d] px-4 py-3 text-xs font-bold text-white" data-testid="button-goto-confirm">Continue to Confirm <ArrowRight size={14} /></button>
          </div>
        </div>
      )}

      {step === 3 && hackathon && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-[#171a2d] p-6 text-[#fdfbf5] sm:p-8">
            <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">Final review</div>
            <h2 className="mt-2 text-2xl font-bold">Your hackathon is ready to publish.</h2>
            <p className="mt-2 text-sm text-[#b9bdca]">{hackathon.title} · {hackathon.status} · v{hackathon.version}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setStep(2)} className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] px-4 py-3 text-xs font-bold" data-testid="button-back-edit">Back to Edit</button>
            <button onClick={() => void transition('review')} disabled={loading || hackathon.status !== 'DRAFT'} className="rounded-xl bg-[#5aafbd] px-4 py-3 text-xs font-bold text-white disabled:opacity-40" data-testid="button-to-review">→ REVIEW</button>
            <button onClick={() => void transition('confirm')} disabled={loading || hackathon.status !== 'REVIEW'} className="rounded-xl bg-[#f26a4f] px-4 py-3 text-xs font-bold text-white disabled:opacity-40" data-testid="button-confirm-hackathon">Confirm Hackathon</button>
            <button onClick={() => void transition('publish')} disabled={loading || hackathon.status !== 'CONFIRMED'} className="inline-flex items-center gap-2 rounded-xl bg-[#d8e35b] px-4 py-3 text-xs font-bold text-[#171a2d] disabled:opacity-40" data-testid="button-publish-hackathon"><Rocket size={14} /> Publish Hackathon</button>
          </div>
          {hackathon.status === 'PUBLISHED' && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 flex gap-2"><CheckCircle2 size={16} /><span>Published! Participants now see the organizer-approved version.</span><Link href={`/organizer/hackathons/${hackathonId}`} className="ml-auto font-bold underline">Open workspace</Link></div>}
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex gap-2 items-start">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <p className="text-xs leading-5 text-amber-800"><b>Guardrail:</b> publishing requires your explicit click and CONFIRMED status. AI can never publish — direct transitions return 400.</p>
          </div>
        </div>
      )}
    </div>
  );
}
