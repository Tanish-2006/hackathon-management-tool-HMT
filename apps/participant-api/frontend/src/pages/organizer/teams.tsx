import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { AlertCircle, ArrowLeft, Layers, Search, ShieldCheck, Users, Lock, EyeOff, Loader2 } from 'lucide-react';
import { organizerApi, OrganizerApiError } from '@/services/organizerApi';

export default function OrganizerTeams(){
  const [hackathons,setHackathons]=useState<any[]>([]);
  const [selected,setSelected]=useState<string>('');
  const [teams,setTeams]=useState<any[]>([]);
  const [q,setQ]=useState('');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [repoMsg,setRepoMsg]=useState<string|null>(null);
  const [repoErr,setRepoErr]=useState<string|null>(null);
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
      if(e instanceof OrganizerApiError && e.status===403) setError('Not owner — only owning organizer or ADMIN can list teams for this hackathon.');
      else setError(e.message)
    }).finally(()=>setLoading(false))
  },[selected]);

  const filtered = teams.filter(t=> !q || `${t.name} ${t.id}`.toLowerCase().includes(q.toLowerCase()));

  const tryPrivate = async (teamId:string)=>{
    setRepoMsg(null); setRepoErr(null);
    try{
      const res=await organizerApi.getPrivateRepo(teamId);
      setRepoMsg(`Unexpected success for ${teamId.slice(0,8)}: ${JSON.stringify(res).slice(0,120)}`)
    }catch(e:any){
      // expect 403
      if(e instanceof OrganizerApiError && e.status===403) setRepoErr(`403 ✓ Privacy boundary: ${e.message} (team ${teamId.slice(0,8)})`)
      else setRepoErr(e.message)
    }
  }

  if(initial) return <div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/organizer/dashboard" className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] p-2"><ArrowLeft size={16}/></Link>
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">Organizer · teams</div>
          <h1 className="text-2xl font-bold">Teams</h1>
          <p className="text-xs text-[#77798a]">GET /hackathons/:id/teams — private-repo indicator: GET /teams/:teamId/private-repo should be 403 (privacy boundary).</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex-1 text-sm font-semibold">Hackathon<select value={selected} onChange={e=>setSelected(e.target.value)} className="hmt-input">{hackathons.map(h=> <option key={h.id} value={h.id}>{h.title} — {h.status}</option>)}</select></label>
        <label className="relative flex-1 text-sm font-semibold">Search<div className="relative"><Search size={14} className="absolute left-3 top-3 text-[#aaa9a2]"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Filter by team name" className="hmt-input pl-9 mt-1"/></div></label>
        <button onClick={()=> selected && organizerApi.listTeams(selected).then(setTeams).catch((e:any)=>setError(e.message))} className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] px-4 py-3 text-xs font-bold h-fit self-end">Refresh</button>
      </div>

      {repoMsg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 flex gap-2"><ShieldCheck size={16}/>{repoMsg}<button onClick={()=>setRepoMsg(null)} className="ml-auto text-xs font-bold">×</button></div>}
      {repoErr && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 flex gap-2"><Lock size={16}/>{repoErr}<button onClick={()=>setRepoErr(null)} className="ml-auto text-xs font-bold">×</button></div>}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2"><AlertCircle size={16}/>{error}</div>}

      {loading ? <div className="flex items-center gap-2 text-sm text-[#77798a]"><Loader2 size={16} className="animate-spin"/> Loading teams…</div> : null}

      {!loading && !error && filtered.length===0 ? (
        <div className="rounded-2xl border border-dashed border-[#dedbd1] bg-[#fdfbf5] p-8 text-center">
          <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-[#f4f1e8]"><Layers size={18}/></div>
          <h3 className="mt-3 font-bold">No teams yet</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-[#77798a]">Seed demo teams or wait for participants to form teams. Privacy boundary will be enforced for every team.</p>
          {selected && <button onClick={async()=>{ try{ await organizerApi.seedDemo(selected); const t=await organizerApi.listTeams(selected); setTeams(t)}catch(e:any){setError(e.message)}}} className="mt-4 rounded-xl bg-[#171a2d] px-4 py-2 text-xs font-bold text-white">Seed demo teams</button>}
        </div>
      ) : null}

      {!loading && filtered.length>0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((t:any)=>(
            <div key={t.id} className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5 hover:-translate-y-0.5 transition-transform">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-bold">{t.name}</div>
                  <div className="text-xs text-[#77798a]">Id {t.id.slice(0,12)} · {t.memberCount ?? t.members?.length ?? 0} members</div>
                </div>
                <span className="rounded-full bg-[#f4f1e8] px-2 py-1 text-[10px] font-bold uppercase flex items-center gap-1"><Users size={12}/>{t.memberCount ?? t.members?.length ?? 0}</span>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {(t.members||[]).slice(0,4).map((m:any,i:number)=><span key={i} className="rounded-full bg-[#e9e5da] px-2 py-1 text-[11px] font-semibold">{m.displayName || m.userId?.slice(0,6) || 'MEM'}</span>)}
                {(t.members?.length||0)===0 && <span className="text-xs text-[#77798a]">No public members listed</span>}
              </div>

              <div className="mt-3 rounded-xl bg-[#f4f1e8] p-3">
                <div className="text-xs font-bold flex items-center gap-1"><Layers size={12}/> Project</div>
                {t.project ? (
                  <div className="mt-1 text-xs">
                    <div className="font-bold">{t.project.title}</div>
                    <div className="text-[#77798a] line-clamp-2">{t.project.description}</div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${t.project.hasRepository ? 'bg-[#d8e35b] text-[#171a2d]' : 'bg-[#e9e5da] text-[#77798a]'}`}>{t.project.hasRepository ? 'HAS REPO' : 'NO REPO'}</span>
                      <span className="text-[11px] text-[#77798a] flex items-center gap-1"><EyeOff size={12}/> repoUrl hidden (privacy)</span>
                    </div>
                    {t.project.repoUrl && <div className="mt-1 text-[11px] text-red-600">⚠ repoUrl leaked (should not happen) — boundary violated</div>}
                  </div>
                ) : <div className="text-xs text-[#77798a]">No project linked</div>}
                <div className="mt-2 text-[11px] text-[#77798a]">inviteCode hidden — privacy boundary</div>
              </div>

              <button onClick={()=>tryPrivate(t.id)} className="mt-3 w-full rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white flex items-center justify-center gap-2"><Lock size={14}/> Try private-repo (expect 403)</button>
              <div className="mt-2 text-[11px] text-center text-[#77798a]">GET /teams/{t.id.slice(0,8)}/private-repo → 403</div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-[#dedbd1] bg-[#f4f1e8] p-4 flex gap-3">
        <ShieldCheck size={16} className="text-[#5aafbd] mt-0.5"/>
        <p className="text-xs leading-5 text-[#77798a]"><b className="text-[#171a2d]">Privacy boundary:</b> Organizer can see participants/teams/projects but NOT private repo contents. Repo URL is hidden (hasRepository boolean only). Direct private-repo access returns 403 with <i>private team repositories</i>.</p>
      </div>
    </div>
  )
}
