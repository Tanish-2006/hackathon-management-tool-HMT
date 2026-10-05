import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, Calendar, Search, Loader2, AlertCircle, ShieldCheck, Megaphone, Clock3, Users, Trophy } from 'lucide-react';
import { hmtBackendService, ApiError } from '@/services/backendApi';
import { cn } from '@/lib/utils';

function friendly(e:unknown){ return e instanceof ApiError ? e.message : (e as Error)?.message || 'Failed' }

function Badge({ children, tone='muted' }: any){
  const m:any={ lime:'bg-[#d8e35b] text-[#171a2d]', coral:'bg-[#f26a4f] text-white', blue:'bg-[#5aafbd] text-white', dark:'bg-[#171a2d] text-white', muted:'bg-[#e9e5da] text-[#77798a]' }
  return <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider", m[tone]||m.muted)}>{children}</span>
}

const TABS = ['Overview','Challenge','Eligibility','Timeline','Rules','Resources','Prizes','Judging','FAQs','Register'] as const;

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
  const [tab,setTab]=useState<typeof TABS[number]>('Overview');
  const [registerMsg,setRegisterMsg]=useState<string|null>(null);
  const [registering,setRegistering]=useState(false);

  async function load(){
    setLoading(true); setError(null);
    try{
      const res = await hmtBackendService.listHackathons({
        ...(search.trim()?{search:search.trim()}:{}),
        ...(status?{status}:{}),
        ...(mode?{mode}:{}),
        ...(registration?{registration}:{}),
        pageSize: 30,
      });
      const data = Array.isArray(res) ? res : (res.data ?? []);
      setRows(data);
      setTotal(res.pagination?.total ?? data.length);
      if(data.length && !selectedId) setSelectedId(data[0].id);
    }catch(e){ setError(friendly(e)); }
    finally{ setLoading(false); }
  }

  useEffect(()=>{ load(); },[]);
  useEffect(()=>{
    if(!selectedId) { setDetail(null); return; }
    let m=true;
    setDetailLoading(true);
    hmtBackendService.getHackathonById(selectedId).then(d=>{ if(m){ setDetail(d); setTab('Overview'); setRegisterMsg(null);} }).catch(()=>{ if(m) setDetail(rows.find(r=>r.id===selectedId) ?? null); }).finally(()=>{ if(m) setDetailLoading(false); });
    return ()=>{ m=false; };
  },[selectedId]);

  const selected = detail ?? rows.find(r=>r.id===selectedId) ?? null;
  const phases = selected?.phases ?? [];
  const criteria = selected?.judgingCriteria ?? [];
  const resources = selected?.resources ?? [];
  const anns = selected?.announcements ?? [];

  async function register(){
    if(!selected) return;
    setRegistering(true); setRegisterMsg(null);
    try{
      await hmtBackendService.registerForHackathon(selected.id, { teamChoice: 'later' });
      setRegisterMsg('Registered — see My Hackathons for next steps (team choice).');
    }catch(e:any){
      const msg = friendly(e);
      // Skill-profile gate → direct to profile, never duplicate the form here.
      setRegisterMsg(msg.includes('skill profile') ? 'Complete your skill profile first — then register. Your profile is reused for eligibility + team matching.' : msg);
    }finally{ setRegistering(false); }
  }

  const filteredHint = useMemo(()=> `${total} published hackathon${total===1?'':'s'}`,[total]);

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
          )) : <div className="p-8 text-center text-sm text-[#77798a]">No published hackathons match. Try clearing filters.</div>}
        </div>

        {/* Detail with tabs */}
        <div id="details" className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
          {detailLoading ? <div className="text-sm text-[#77798a]">Loading details…</div> : selected ? (
            <>
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
                  <div className="space-y-2">{phases.length?phases.map((p:any,i:number)=><div key={i} className="flex justify-between rounded-xl border border-[#e5e1d7] px-3 py-2 text-xs"><span className="font-semibold">{p.name}</span><span>{p.startsAt?new Date(p.startsAt).toLocaleDateString():''} → {p.endsAt?new Date(p.endsAt).toLocaleDateString():''}</span></div>):<span className="text-[#77798a]">Timeline published by organizer.</span>}</div>
                )}
                {tab==='Rules' && <ul className="list-disc pl-5">{(selected.rules??[]).map((r:string,i:number)=><li key={i}>{r}</li>)}</ul>}
                {tab==='Resources' && <div className="grid gap-2">{resources.map((r:any,i:number)=><a key={i} href={r.url} target="_blank" rel="noreferrer" className="rounded-xl border border-[#dedbd1] px-3 py-2 text-xs hover:bg-[#f4f1e8]">{r.name ?? r.title}</a>)}</div>}
                {tab==='Prizes' && <p className="text-[#77798a]">Prizes announced by organizer{selected.prizes?`: ${(selected.prizes as any[]).map((p:any)=>p.title).join(', ')}`:'.'}</p>}
                {tab==='Judging' && <div className="space-y-2">{criteria.map((c:any,i:number)=><div key={i} className="flex justify-between rounded-xl bg-[#f4f1e8] px-3 py-2 text-xs"><span>{c.name}</span><span className="font-mono font-bold">{c.weight?Math.round(c.weight*100)+'%':'—'}</span></div>)}</div>}
                {tab==='FAQs' && <p className="text-[#77798a]">FAQs published by organizer appear here.</p>}
                {tab==='Register' && (
                  <div className="rounded-xl bg-[#f4f1e8] p-4">
                    <div className="flex items-center gap-2 text-xs font-bold"><ShieldCheck size={14} className="text-[#5aafbd]"/> Registration uses your skill profile — no repeated forms</div>
                    <button onClick={register} disabled={registering} className="mt-3 rounded-xl bg-[#f26a4f] px-4 py-2 text-xs font-bold text-white disabled:opacity-60">{registering?'Registering…':'Register for this hackathon'}</button>
                    {registerMsg && <p className="mt-2 text-xs text-[#55586a]">{registerMsg} <Link href="/participant/profile" className="underline">Open skill profile</Link></p>}
                    <div className="mt-3 flex items-center gap-2 text-[11px] text-[#77798a]"><Clock3 size={12}/> Registration ends: {selected.registrationEnd?new Date(selected.registrationEnd).toLocaleString():'see timeline'} · <Trophy size={12}/> Team choice after confirm → My Hackathons</div>
                  </div>
                )}
              </div>
              {!!anns.length && (
                <div className="mt-6 rounded-2xl bg-[#171a2d] p-4 text-[#fdfbf5]">
                  <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b] flex items-center gap-2"><Megaphone size={13}/> Announcements — published only</div>
                  <div className="mt-2 space-y-2">{anns.slice(0,3).map((a:any)=><div key={a.id} className="rounded-xl bg-[#252941] p-3 text-xs"><b>{a.title}</b><p className="text-[#b9bdca]">{a.content}</p></div>)}</div>
                </div>
              )}
            </>
          ) : <div className="text-sm text-[#77798a]">Select a hackathon to see details.</div>}
        </div>
      </div>
      )}
    </div>
  );
}
