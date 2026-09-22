import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { AlertCircle, ArrowLeft, ChevronRight, ExternalLink, Layers, Loader2, Search, Users } from 'lucide-react';
import { organizerApi, OrganizerApiError } from '@/services/organizerApi';

export default function MentorTeams(){
  const [me,setMe]=useState<any|null>(null);
  const [teams,setTeams]=useState<any[]>([]);
  const [q,setQ]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);

  useEffect(()=>{
    let m=true;
    async function load(){
      setLoading(true); setError(null);
      try{
        const meData = await organizerApi.getMe();
        if(!m) return; setMe(meData);
        const id = (meData as any).id || (meData as any).user?.id;
        const list = await organizerApi.listMentorTeams(id);
        if(!m) return; setTeams(list);
      }catch(e:any){
        if(!m) return;
        if(e instanceof OrganizerApiError && e.status===403) setError('You can only view your own assigned teams. Sign in as the correct mentor.');
        else setError(e.message)
      } finally{ if(m) setLoading(false)}
    }
    load(); return()=>{m=false}
  },[]);

  const filtered = teams.filter(t=> !q || `${t.name||''} ${t.id}`.toLowerCase().includes(q.toLowerCase()));

  if(loading) return <div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/>
  if(error) return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 flex gap-3"><AlertCircle size={18}/><div><b>Could not load mentor teams</b><p className="mt-1">{error}</p><button onClick={()=>location.reload()} className="mt-3 rounded-lg bg-[#171a2d] px-3 py-1.5 text-xs font-bold text-white">Retry</button></div></div>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/mentor/dashboard" className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] p-2"><ArrowLeft size={16}/></Link>
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">Mentor · teams</div>
          <h1 className="text-2xl font-bold">Teams</h1>
          <p className="text-xs text-[#77798a]">GET /mentors/:mentorId/teams — same as dashboard, permission-aware (own assignments only).</p>
        </div>
      </div>

      <div className="flex gap-3">
        <label className="relative flex-1"><Search size={14} className="absolute left-3 top-3 text-[#aaa9a2]"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search team name or id" className="hmt-input pl-9"/></label>
        <Link href="/mentor/feedback" className="rounded-xl bg-[#171a2d] px-4 py-3 text-xs font-bold text-white h-fit self-end">Give feedback</Link>
      </div>

      {filtered.length===0 ? (
        <div className="rounded-2xl border border-dashed border-[#dedbd1] bg-[#fdfbf5] p-10 text-center">
          <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-[#f4f1e8]"><Layers size={18}/></div>
          <h3 className="mt-3 font-bold">No assigned teams</h3>
          <p className="mt-1 text-sm text-[#77798a]">You will see teams here after an organizer assigns you (POST /hackathons/:id/mentor-assignments).</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((t:any)=>(
            <div key={t.id} className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5 hover:-translate-y-1 transition-transform">
              <div className="flex items-center justify-between">
                <span className="font-bold">{t.name || t.id.slice(0,12)}</span>
                <span className="rounded-full bg-[#f4f1e8] px-2 py-1 text-[10px] font-bold flex items-center gap-1"><Users size={12}/>{t.memberCount ?? t.members?.length ?? 0}</span>
              </div>
              <div className="mt-2 text-xs text-[#77798a]">Hackathon {t.hackathonId?.slice(0,8)} · Team {t.id.slice(0,12)}</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(t.members||[]).slice(0,4).map((m:any,i:number)=> <span key={i} className="rounded-full bg-[#e9e5da] px-2 py-1 text-[11px] font-semibold">{m.displayName || m.userId?.slice(0,6)}</span>)}
                {(t.members?.length||0)===0 && <span className="text-xs text-[#77798a]">Members hidden until assignment confirmed</span>}
              </div>
              <div className="mt-3 rounded-xl bg-white border border-[#e5e1d7] p-3">
                <div className="text-xs font-bold">Project</div>
                {t.project ? <div className="text-xs"><b>{t.project.title}</b> — {t.project.description?.slice(0,80)}</div> : <div className="text-xs text-[#77798a]">No project yet</div>}
                {t.project?.repoUrl && <a href={t.project.repoUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-[#5aafbd] underline">Repo <ExternalLink size={12}/></a>}
              </div>
              <Link href="/mentor/feedback" className="mt-3 flex items-center justify-center gap-1 rounded-xl bg-[#f26a4f] px-3 py-2 text-xs font-bold text-white">Provide feedback <ChevronRight size={12}/></Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
