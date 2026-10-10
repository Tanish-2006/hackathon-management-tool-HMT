import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, Calendar, Search, Loader2, AlertCircle, ShieldCheck, Megaphone, Clock3, Users, Trophy } from 'lucide-react';
import { hmtBackendService, ApiError } from '@/services/backendApi';
import RegistrationForm from '@/pages/participant/registration-form';
import { cn } from '@/lib/utils';

function friendly(e:unknown){ return e instanceof ApiError ? e.message : (e as Error)?.message || 'Failed' }

// Date + time for phase ranges (hour/minute precision — date-only hides
// zero-duration/ordering problems the backend now guarantees against).
function fmtDT(v: unknown){
  if(!v) return '—';
  const t = new Date(v as string);
  if(Number.isNaN(t.getTime())) return '—';
  return t.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Badge({ children, tone='muted' }: any){
  const m:any={ lime:'bg-[#d8e35b] text-[#171a2d]', coral:'bg-[#f26a4f] text-white', blue:'bg-[#5aafbd] text-white', dark:'bg-[#171a2d] text-white', muted:'bg-[#e9e5da] text-[#77798a]' }
  return <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider", m[tone]||m.muted)}>{children}</span>
}

const TABS = ['Overview','Challenge','Eligibility','Timeline','Rules','Resources','Prizes','Judging','FAQs'] as const;

// Registration-closure display state (informational only — the backend
// enforces the lock on every mutation using server time).
function lockInfo(h: any): { locked: boolean; reason: string | null } {
  if (!h) return { locked: false, reason: null };
  if ((h.status ?? 'PUBLISHED') === 'ARCHIVED') {
    return { locked: true, reason: 'This hackathon is archived — team changes are locked.' };
  }
  const t = h.registrationEnd ? new Date(h.registrationEnd).getTime() : null;
  if (t !== null && !Number.isNaN(t) && Date.now() > t) {
    return { locked: true, reason: 'Registration is closed — team creation and joining are locked.' };
  }
  return { locked: false, reason: null };
}

export default function ParticipantHackathons(){
  const [rows,setRows]=useState<any[]>([]);
  const [total,setTotal]=useState(0);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [search,setSearch]=useState('');
  const [status,setStatus]=useState('');
  const [mode,setMode]=useState('');
  const [registration,setRegistration]=useState('');
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [detail,setDetail]=useState<any>(null);
  const [detailLoading,setDetailLoading]=useState(false);
  const [detailError,setDetailError]=useState<string|null>(null);
  const [tab,setTab]=useState<typeof TABS[number]>('Overview');
  const [registerMsg,setRegisterMsg]=useState<string|null>(null);
  const [registeredIds,setRegisteredIds]=useState<Set<string>>(new Set());
  const [pulled,setPulled]=useState(false);
  const [syncing,setSyncing]=useState(false);
  const [syncMsg,setSyncMsg]=useState<string|null>(null);

  async function load(){
    setLoading(true); setError(null);
    try{
      const params = {
        ...(search.trim()?{search:search.trim()}:{}),
        ...(status?{status}:{}),
        ...(mode?{mode}:{}),
        ...(registration?{registration}:{}),
        pageSize: 30,
      };
      const res = await hmtBackendService.listHackathons(params);
      let data = Array.isArray(res) ? res : (res.data ?? []);
      let total = res.pagination?.total ?? data.length;
      // Self-healing sync: an empty published list usually means the organizer
      // publish event never reached this read-model (push is best-effort).
      // Pull the organizer outbox once per page load (server defaults,
      // idempotent by eventId) and re-read with the SAME filters — never
      // fabricates records. Fires even with search/filters active, because a
      // typed-but-unmatched query is exactly the reported symptom.
      if(!data.length && !pulled){
        try{
          await hmtBackendService.pullSync();
          const retry = await hmtBackendService.listHackathons(params);
          data = Array.isArray(retry) ? retry : (retry.data ?? []);
          total = (retry as any)?.pagination?.total ?? data.length;
        }catch{ /* keep honest empty state on failure */ }
        setPulled(true);
      }
      setRows(data);
      setTotal(total);
      if(data.length && !selectedId) setSelectedId(data[0].id);
      // Registration state drives Register vs Registered CTA (real backend state).
      hmtBackendService.getMyRegistrations().then((regs:any)=>{
        const list = Array.isArray(regs)?regs:(regs?.data??[]);
        setRegisteredIds(new Set(list.map((r:any)=>String(r.hackathonId))));
      }).catch(()=>null);
    }catch(e){ setError(friendly(e)); }
    finally{ setLoading(false); }
  }

  useEffect(()=>{ load(); },[]);
  useEffect(()=>{
    if(!selectedId) { setDetail(null); return; }
    let m=true;
    setDetailLoading(true);
    setDetailError(null);
    // A failed detail fetch falls back to the list row (no phases/criteria),
    // but the failure is surfaced instead of silently masked.
    hmtBackendService.getHackathonById(selectedId).then(d=>{ if(m){ setDetail(d); setTab('Overview'); setRegisterMsg(null);} }).catch((e:any)=>{ if(m){ setDetail(rows.find(r=>r.id===selectedId) ?? null); setDetailError(e?.message || 'Could not load full details.'); } }).finally(()=>{ if(m) setDetailLoading(false); });
    return ()=>{ m=false; };
  },[selectedId]);

  const selected = detail ?? rows.find(r=>r.id===selectedId) ?? null;
  const phases = selected?.phases ?? [];
  const criteria = selected?.judgingCriteria ?? [];
  const resources = selected?.resources ?? [];
  const anns = selected?.announcements ?? [];

  // Panel state from live backend data (refreshed, never assumed):
  // A unregistered, B registered-no-team, C in team, D locked.
  const isRegistered = !!selected && registeredIds.has(String(selected.id));
  const lock = lockInfo(selected);
  const [myTeamSelected,setMyTeamSelected]=useState<any|null>(null);
  async function refreshSelectedTeam(){
    if(!selected) { setMyTeamSelected(null); return; }
    try{
      const t = await hmtBackendService.getMyTeam(selected.id);
      const team = (t as any)?.team ?? t;
      setMyTeamSelected(team && team.id ? team : null);
    }catch{ setMyTeamSelected(null); }
  }
  useEffect(()=>{
    if(isRegistered && selected) refreshSelectedTeam();
    else setMyTeamSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[selected?.id, registeredIds]);

  const filteredHint = useMemo(()=> `${total} published hackathon${total===1?'':'s'}`,[total]);

  // Manual recovery: re-pull the organizer outbox on demand (idempotent,
  // server defaults). Lets a published hackathon appear without recreating it.
  async function syncNow(){
    setSyncing(true); setSyncMsg(null);
    try{
      const r: any = await hmtBackendService.pullSync();
      const results = r?.results ?? [];
      const ok = results.filter((x:any)=>x?.ok).length;
      await load();
      setSyncMsg(ok ? `Synced ${ok} published update${ok===1?'':'s'} from the organizer.` : 'Sync finished — no new published updates found.');
    }catch(e:any){
      setSyncMsg(friendly(e));
    }finally{
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">Discover — Published only</div>
          <h1 className="mt-2 text-3xl font-bold tracking-[-.05em] text-[#171a2d]">Hackathons</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#77798a]">Search the canonical published list. Drafts stay private to organizers. {filteredHint}.</p>
        </div>
        <Link href="/participant/my-hackathons" className="rounded-xl bg-[#171a2d] px-4 py-2 text-xs font-bold text-white">My Hackathons</Link>
      </div>

      {/* Search + minimal filters (Unstop/Hack2Skill pattern) */}
      <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-4">
        <div className="flex flex-col gap-3 lg:flex-row">
          <label className="flex flex-1 items-center gap-2 rounded-xl border border-[#dedbd1] bg-white px-3 py-2">
            <Search size={15} className="text-[#77798a]"/>
            <input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter') load(); }} placeholder="Search title, organizer, theme, tags…" className="w-full bg-transparent text-sm outline-none"/>
          </label>
          <select value={status} onChange={e=>setStatus(e.target.value)} className="rounded-xl border border-[#dedbd1] bg-white px-3 py-2 text-xs font-semibold">
            <option value="">All statuses</option>
            <option value="REGISTRATION_OPEN">Registration open</option>
            <option value="REGISTRATION_CLOSED">Registration closed</option>
            <option value="LIVE">Live</option>
            <option value="SUBMISSION">Submission</option>
            <option value="EVALUATION">Evaluation</option>
            <option value="COMPLETED">Completed</option>
          </select>
          <select value={mode} onChange={e=>setMode(e.target.value)} className="rounded-xl border border-[#dedbd1] bg-white px-3 py-2 text-xs font-semibold">
            <option value="">All modes</option>
            <option value="ONLINE">Online</option>
            <option value="OFFLINE">Offline</option>
            <option value="HYBRID">Hybrid</option>
          </select>
          <select value={registration} onChange={e=>setRegistration(e.target.value)} className="rounded-xl border border-[#dedbd1] bg-white px-3 py-2 text-xs font-semibold">
            <option value="">Registration: all</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
          <button onClick={load} className="rounded-xl bg-[#f26a4f] px-4 py-2 text-xs font-bold text-white">Search</button>
        </div>
      </div>

      {loading ? <div className="flex items-center gap-2 text-sm text-[#77798a]"><Loader2 size={16} className="animate-spin"/> Loading published hackathons…</div>
      : error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 flex gap-3"><AlertCircle size={18}/><div><b>Could not load hackathons</b><p className="mt-1">{error}</p><button onClick={load} className="mt-3 rounded-lg bg-[#171a2d] px-3 py-1.5 text-xs font-bold text-white">Retry</button></div></div>
      : (
      <div className="grid gap-6 lg:grid-cols-[.9fr_1.1fr]">
        {/* Compact list rows (not card grid) */}
        <div className="overflow-hidden rounded-2xl border border-[#dedbd1] bg-[#fdfbf5]">
          <div className="border-b border-[#e5e1d7] px-4 py-3 font-mono text-[10px] uppercase tracking-[.14em] text-[#77798a]">Hackathon | Mode | Registration ends | Status | Action</div>
          {rows.length ? rows.map(r=>(
            <button key={r.id} onClick={()=>setSelectedId(r.id)} className={cn("flex w-full items-center gap-3 border-b border-[#f0ede4] px-4 py-3 text-left hover:bg-[#f4f1e8]", selectedId===r.id && "bg-[#fff7ea]")}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{r.title}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-[#77798a]">
                  <span>{r.organizer ?? 'HMT'}</span><span>·</span><span>{r.mode}</span><span>·</span>
                  <span className="inline-flex items-center gap-1"><Calendar size={11}/> {r.registrationEnd ? new Date(r.registrationEnd).toLocaleDateString() : (r.eventStart ? new Date(r.eventStart).toLocaleDateString() : '—')}</span>
                </div>
              </div>
              <Badge tone={r.derivedStatus==='REGISTRATION_OPEN'?'lime':r.derivedStatus==='LIVE'||r.derivedStatus==='SUBMISSION'?'coral':'muted'}>{r.derivedStatus}</Badge>
              <ArrowRight size={15} className="shrink-0 text-[#77798a]"/>
            </button>
          )) : <div className="p-8 text-center text-sm text-[#77798a]">
            <p>No published hackathons match. Try clearing filters.</p>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-5">If an organizer just published one, it may not have synced yet — pull the latest published updates (never creates or modifies anything).</p>
            <button onClick={syncNow} disabled={syncing} className="mt-3 rounded-xl bg-[#171a2d] px-4 py-2 text-xs font-bold text-white disabled:opacity-60">{syncing?'Syncing…':'Sync from organizer'}</button>
            {syncMsg && <p className="mt-2 text-xs text-[#55586a]">{syncMsg}</p>}
          </div>}
        </div>

        {/* Detail with tabs */}
        <div id="details" className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
          {detailLoading ? <div className="text-sm text-[#77798a]">Loading details…</div> : selected ? (
            <>
              {detailError && <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{detailError} Showing list summary instead.</div>}
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold tracking-tight">{selected.title}</h2>
                <Badge tone="dark">{selected.derivedStatus ?? selected.status}</Badge>
              </div>
              <p className="mt-2 text-sm leading-6 text-[#77798a]">{selected.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {TABS.map(t=>(
                  <button key={t} onClick={()=>setTab(t)} className={cn("rounded-full px-3 py-1.5 text-[11px] font-bold", tab===t ? "bg-[#171a2d] text-white" : "bg-[#f4f1e8] text-[#55586a] hover:bg-[#e9e5da]")}>{t}</button>
                ))}
              </div>
              <div className="mt-5 text-sm leading-6">
                {tab==='Overview' && <p className="text-[#33364a]">{selected.description}</p>}
                {tab==='Challenge' && <p>{selected.problemStatement ?? selected.description ?? 'Open innovation — propose your own solution under the theme.'}</p>}
                {tab==='Eligibility' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-bold"><Users size={14}/> Who can participate</div>
                    <ul className="list-disc pl-5 text-[#33364a]">{(selected.eligibility?.length?selected.eligibility:['Open to all']).map((e:string)=><li key={e}>{e}</li>)}</ul>
                    <div className="text-xs text-[#77798a]">Team size: {selected.teamSize ? `${selected.teamSize.min}–${selected.teamSize.max}` : 'see rules'}</div>
                  </div>
                )}
                {tab==='Timeline' && (
                  <div className="space-y-2">{phases.length?phases.map((p:any,i:number)=><div key={i} className="flex justify-between gap-3 rounded-xl border border-[#e5e1d7] px-3 py-2 text-xs"><span className="font-semibold">{p.order ? `#${p.order} ` : ''}{p.name}</span><span className="whitespace-nowrap font-mono">{fmtDT(p.startsAt)} → {fmtDT(p.endsAt)}</span></div>):<span className="text-[#77798a]">Timeline published by organizer.</span>}</div>
                )}
                {tab==='Rules' && <ul className="list-disc pl-5">{(selected.rules??[]).map((r:string,i:number)=><li key={i}>{r}</li>)}</ul>}
                {tab==='Resources' && <div className="grid gap-2">{resources.map((r:any,i:number)=><a key={i} href={r.url} target="_blank" rel="noreferrer" className="rounded-xl border border-[#dedbd1] px-3 py-2 text-xs hover:bg-[#f4f1e8]">{r.name ?? r.title}</a>)}</div>}
                {tab==='Prizes' && <p className="text-[#77798a]">Prizes announced by organizer{selected.prizes?`: ${(selected.prizes as any[]).map((p:any)=>p.title).join(', ')}`:'.'}</p>}
                {tab==='Judging' && <div className="space-y-2">{criteria.map((c:any,i:number)=><div key={i} className="flex justify-between rounded-xl bg-[#f4f1e8] px-3 py-2 text-xs"><span>{c.name}</span><span className="font-mono font-bold">{c.weight?Math.round(c.weight*100)+'%':'—'}</span></div>)}</div>}
                {tab==='FAQs' && <p className="text-[#77798a]">FAQs published by organizer appear here.</p>}
              </div>
              {!!anns.length && (
                <div className="mt-6 rounded-2xl bg-[#171a2d] p-4 text-[#fdfbf5]">
                  <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b] flex items-center gap-2"><Megaphone size={13}/> Announcements — published only</div>
                  <div className="mt-2 space-y-2">{anns.slice(0,3).map((a:any)=><div key={a.id} className="rounded-xl bg-[#252941] p-3 text-xs"><b>{a.title}</b><p className="text-[#b9bdca]">{a.content}</p></div>)}</div>
                </div>
              )}
              {/* Registration — visually separated action section (not an info tab),
                  always last in the details card, after every informational section.
                  State A (unregistered): form. State B (registered, no team):
                  team choice. State C (in team): manage. State D (locked):
                  closed status. Membership re-read from the backend. */}
              <div className="mt-6 rounded-2xl border-2 border-[#171a2d] bg-[#fffdf5] p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-bold"><ShieldCheck size={15} className="text-[#f26a4f]"/> Registration</div>
                  {lock.locked
                    ? <Badge tone="muted">Registration closed</Badge>
                    : isRegistered
                      ? <Badge tone="lime">Registered</Badge>
                      : <Badge tone="coral">Not registered</Badge>}
                </div>
                {lock.locked && <p className="mt-2 text-xs leading-5 text-[#77798a]">{lock.reason}</p>}
                {lock.locked && !isRegistered ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="rounded-xl bg-[#e9e5da] px-4 py-2 text-xs font-bold text-[#77798a]">Registration closed</span>
                  </div>
                ) : !isRegistered ? (
                  <div className="mt-3">
                    <RegistrationForm
                      hackathon={selected}
                      onRegistered={(id)=>{ setRegisteredIds((prev)=> new Set(prev).add(id)); setRegisterMsg('Registered — continue to team choice.'); refreshSelectedTeam(); }}
                    />
                  </div>
                ) : myTeamSelected ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="rounded-xl bg-[#d8e35b] px-4 py-2 text-xs font-bold text-[#171a2d]">Registered</span>
                    <Link href="/participant/my-hackathons" className="rounded-xl bg-[#171a2d] px-4 py-2 text-xs font-bold text-white">Open hackathon</Link>
                    <Link href={`/participant/teams?hackathon=${selected.id}`} className="rounded-xl bg-[#f26a4f] px-4 py-2 text-xs font-bold text-white">View your team</Link>
                  </div>
                ) : lock.locked ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="rounded-xl bg-[#d8e35b] px-4 py-2 text-xs font-bold text-[#171a2d]">Registered</span>
                    <Link href="/participant/my-hackathons" className="rounded-xl bg-[#171a2d] px-4 py-2 text-xs font-bold text-white">Open hackathon</Link>
                  </div>
                ) : (
                  <div className="mt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-xl bg-[#d8e35b] px-4 py-2 text-xs font-bold text-[#171a2d]">Registered</span>
                      <Link href="/participant/my-hackathons" className="rounded-xl bg-[#171a2d] px-4 py-2 text-xs font-bold text-white">Open hackathon</Link>
                    </div>
                    <div className="mt-3 rounded-xl border border-[#dedbd1] bg-white p-3">
                      <div className="text-xs font-bold">Next: choose how you compete</div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <Link href={`/participant/teams?hackathon=${selected.id}&view=create`} className="rounded-xl bg-[#f26a4f] px-4 py-2.5 text-center text-xs font-bold text-white">Create team</Link>
                        <Link href={`/participant/teams?hackathon=${selected.id}&view=join`} className="rounded-xl border border-[#dedbd1] px-4 py-2.5 text-center text-xs font-bold">Join team</Link>
                      </div>
                    </div>
                  </div>
                )}
                {registerMsg && <p className="mt-2 text-xs text-[#55586a]">{registerMsg}</p>}
                <div className="mt-3 flex items-center gap-2 text-[11px] text-[#77798a]"><Clock3 size={12}/> Registration ends: {selected.registrationEnd?new Date(selected.registrationEnd).toLocaleString():'see timeline'} · <Trophy size={12}/> Team choice after confirm → My Hackathons</div>
              </div>
            </>
          ) : <div className="text-sm text-[#77798a]">Select a hackathon to see details.</div>}
        </div>
      </div>
      )}
    </div>
  );
}
