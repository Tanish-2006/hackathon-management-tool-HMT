import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { AlertCircle, ArrowLeft, Layers, Search, Users, Loader2 } from 'lucide-react';
import { organizerApi, OrganizerApiError } from '@/services/organizerApi';

export default function OrganizerTeams(){
  const [hackathons,setHackathons]=useState<any[]>([]);
  const [selected,setSelected]=useState<string>('');
  const [teams,setTeams]=useState<any[]>([]);
  const [q,setQ]=useState('');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [initial,setInitial]=useState(true);

  useEffect(()=>{
    async function init(){
      try{ const list=await organizerApi.listHackathons(); setHackathons(list); if(list[0]) setSelected(list[0].id)}catch(e:any){ setError(e.message)} finally{ setInitial(false)}
    }
    init();
  },[]);
  useEffect(()=>{
    if(!selected) return;
    setLoading(true); setError(null);
    organizerApi.listTeams(selected).then(setTeams).catch((e:any)=>{
      if(e instanceof OrganizerApiError && e.status===403) setError('Only the organizer who owns this hackathon can see its teams.');
      else setError(e.message)
    }).finally(()=>setLoading(false))
  },[selected]);

  const filtered = teams
    .filter(t=> !q || `${t.name} ${t.number ?? ''} ${(t.members||[]).map((m:any)=>m.displayName).join(' ')}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a,b)=> (a.number ?? 1e9) - (b.number ?? 1e9) || String(a.name).localeCompare(String(b.name)));

  if(initial) return <div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/organizer/dashboard" aria-label="Back" title="Back" className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] p-2"><ArrowLeft size={16}/></Link>
        <div>
                    <h1 className="text-2xl font-bold">Teams</h1>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex-1 text-sm font-semibold">Hackathon<select value={selected} onChange={e=>setSelected(e.target.value)} className="hmt-input">{hackathons.map(h=> <option key={h.id} value={h.id}>{h.title} — {h.status}</option>)}</select></label>
        <label className="relative flex-1 text-sm font-semibold">Search<div className="relative"><Search size={14} className="absolute left-3 top-3 text-[#aaa9a2]"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Team, idea number or member" className="hmt-input pl-9 mt-1"/></div></label>
        <button onClick={()=> selected && organizerApi.listTeams(selected).then(setTeams).catch((e:any)=>setError(e.message))} className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] px-4 py-3 text-xs font-bold h-fit self-end">Refresh</button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2"><AlertCircle size={16}/>{error}</div>}

      {loading ? <div className="flex items-center gap-2 text-sm text-[#77798a]"><Loader2 size={16} className="animate-spin"/> Loading teams…</div> : null}

      {!loading && !error && filtered.length===0 ? (
        <div className="rounded-2xl border border-dashed border-[#dedbd1] bg-[#fdfbf5] p-8 text-center">
          <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-[#f4f1e8]"><Layers size={18}/></div>
          <h3 className="mt-3 font-bold">No teams yet</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-[#77798a]">Teams will show up here once participants form them.</p>
        </div>
      ) : null}

      {!loading && filtered.length>0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((t:any)=>(
            <div key={t.id} className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5 hover:-translate-y-0.5 transition-transform">
              <div className="flex items-start justify-between">
                <div>
                  {t.number != null && <div className="font-mono-ui text-[10px] uppercase tracking-[.14em] text-[#77798a]">Idea {t.number}</div>}
                  <div className="font-bold">{t.name}</div>
                  <div className="text-xs text-[#77798a]">{t.memberCount ?? t.members?.length ?? 0} members</div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span className="rounded-full bg-[#f4f1e8] px-2 py-1 text-[10px] font-bold uppercase flex items-center gap-1"><Users size={12}/>{t.memberCount ?? t.members?.length ?? 0}</span>
                  {t.ideationPhase != null && <span className="rounded-full bg-[#171a2d] px-2 py-1 text-[10px] font-bold text-[#d8e35b]">AI phase {t.ideationPhase}/6</span>}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {(t.members||[]).map((m:any,i:number)=><span key={i} className="rounded-full bg-[#e9e5da] px-2 py-1 text-[11px] font-semibold">{m.displayName || 'Member'}</span>)}
                {(t.members?.length||0)===0 && <span className="text-xs text-[#77798a]">No public members listed</span>}
              </div>

              <div className="mt-3 rounded-xl bg-[#f4f1e8] p-3">
                <div className="text-xs font-bold flex items-center gap-1"><Layers size={12}/> Project</div>
                {t.project ? (
                  <div className="mt-1 text-xs">
                    <div className="font-bold">{t.project.title}</div>
                    <div className="text-[#77798a] line-clamp-2">{t.project.description}</div>
                    {t.project.problemStatement && <div className="mt-1 line-clamp-2"><span className="font-semibold">Problem:</span> {t.project.problemStatement}</div>}
                    <div className="mt-1 flex items-center gap-2">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${t.project.hasRepository ? 'bg-[#d8e35b] text-[#171a2d]' : 'bg-[#e9e5da] text-[#77798a]'}`}>{t.project.hasRepository ? 'Has repository' : 'No repository'}</span>
                    </div>
                  </div>
                ) : <div className="text-xs text-[#77798a]">No project linked</div>}
              </div>

            </div>
          ))}
        </div>
      )}
    </div>
  )
}
