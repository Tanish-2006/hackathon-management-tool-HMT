import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { AlertCircle, ArrowLeft, Award, Layers, Loader2, ShieldCheck, Star, Users } from 'lucide-react';
import { organizerApi, OrganizerApiError } from '@/services/organizerApi';

function Stat({label,value,sub}:{label:string;value:string;sub:string}){
  return <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-4"><div className="font-mono text-[11px] uppercase tracking-wider text-[#77798a]">{label}</div><div className="mt-2 text-2xl font-bold">{value}</div><div className="text-xs text-[#77798a]">{sub}</div></div>
}

export default function MentorProfile(){
  const [me,setMe]=useState<any|null>(null);
  const [teams,setTeams]=useState<any[]>([]);
  const [feedbacks,setFeedbacks]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);

  useEffect(()=>{
    let m=true;
    async function load(){
      setLoading(true); setError(null);
      try{
        const meData=await organizerApi.getMe();
        if(!m) return; setMe(meData);
        const mentorId=(meData as any).id || (meData as any).user?.id;
        const [t] = await Promise.allSettled([
          organizerApi.listMentorTeams(mentorId).catch(()=>[]),
        ]);
        if(!m) return;
        if(t.status==='fulfilled') setTeams(t.value as any);
        if(t.status==='fulfilled' && (t.value as any)[0]?.hackathonId){
          const hid=(t.value as any)[0].hackathonId;
          const fbs=await organizerApi.listFeedbacks(hid).catch(()=>[]);
          const own=(fbs as any).filter((f:any)=> f.mentorId===mentorId);
          if(m) setFeedbacks(own);
        }
      }catch(e:any){
        if(!m) return;
        if(e instanceof OrganizerApiError && e.status===401) setError('Your session expired. Please sign in again.');
        else setError(e.message)
      } finally{ if(m) setLoading(false)}
    }
    load(); return()=>{m=false}
  },[]);

  if(loading) return <div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/>
  if(error) return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 flex gap-3"><AlertCircle size={18}/><div><b>Could not load profile</b><p className="mt-1">{error}</p></div></div>
  if(!me) return <div className="text-sm text-[#77798a]">No profile</div>

  const email=me.email || me.user?.email || '—';
  const mentorId=me.id || me.user?.id || '—';
  const role = me.role || me.user?.role || '—';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/mentor/dashboard" className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] p-2"><ArrowLeft size={16}/></Link>
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">Profile</div>
          <h1 className="text-2xl font-bold">Profile</h1>
        </div>
      </div>

      <div className="rounded-2xl bg-[#171a2d] p-6 text-[#fdfbf5] sm:p-8">
        <div className="flex gap-4">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-[#d8e35b] text-xl font-bold text-[#171a2d]">{email.slice(0,2).toUpperCase()}</div>
          <div>
            <div className="font-bold text-lg">{email}</div>
            <div className="text-sm text-[#b9bdca]">Mentor ID <span className="font-mono text-xs select-all">{String(mentorId)}</span> · share it with your organizer</div>
            <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-[#252941] px-2.5 py-1 text-xs"><ShieldCheck size={12} className="text-[#d8e35b]"/> Mentor workspace</div>
          </div>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-[#252941] p-4 text-center"><div className="font-mono text-2xl">{teams.length}</div><div className="text-xs text-[#9b9fb1]">assigned teams</div></div>
          <div className="rounded-xl bg-[#252941] p-4 text-center"><div className="font-mono text-2xl">{feedbacks.length}</div><div className="text-xs text-[#9b9fb1]">feedbacks submitted</div></div>
          <div className="rounded-xl bg-[#d8e35b] p-4 text-center text-[#171a2d]"><div className="font-mono text-2xl font-bold">{feedbacks.filter((f:any)=>f.publicationStatus==='PUBLISHED').length}</div><div className="text-xs">published</div></div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Assigned teams" value={String(teams.length)} sub="Teams you mentor"/>
        <Stat label="Feedback given" value={String(feedbacks.length)} sub="All submissions by you"/>
        <Stat label="Avg score given" value={feedbacks.length ? (feedbacks.reduce((a:any,f:any)=>a+f.score,0)/feedbacks.length).toFixed(1) : '—'} sub="Across your feedback"/>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
          <h3 className="font-bold flex items-center gap-2"><Users size={16} className="text-[#f26a4f]"/> Assigned teams</h3>
          {teams.length ? (
            <div className="mt-3 space-y-2">
              {teams.map((t:any)=>(
                <div key={t.id} className="rounded-xl border border-[#e5e1d7] bg-white px-3 py-2 text-sm flex justify-between"><span><b>{t.name || 'Unnamed team'}</b></span><span className="text-xs text-[#77798a]">{t.memberCount ?? t.members?.length ?? 0} members</span></div>
              ))}
            </div>
          ) : <div className="mt-3 rounded-xl bg-[#f4f1e8] p-4 text-xs text-[#77798a]">No teams assigned yet. Share your mentor ID with the organizer.</div>}
          <Link href="/mentor/teams" className="mt-3 inline-flex text-xs font-bold text-[#5aafbd]">View teams →</Link>
        </div>

        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
          <h3 className="font-bold flex items-center gap-2"><Star size={16} className="text-[#d8e35b]"/> Your feedback</h3>
          {feedbacks.length ? (
            <div className="mt-3 space-y-2 max-h-64 overflow-auto">
              {feedbacks.map((f:any)=>(
                <div key={f.id} className="rounded-xl border border-[#e5e1d7] bg-white p-3">
                  <div className="flex justify-between"><span className="font-bold text-sm">Score {f.score} · v{f.version}</span><span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${f.publicationStatus==='PUBLISHED'?'bg-[#d8e35b] text-[#171a2d]': f.publicationStatus==='ORGANIZER_REVIEWED'?'bg-[#5aafbd] text-white':'bg-[#e9e5da]'}`}>{f.publicationStatus}</span></div>
                  <div className="text-xs mt-1">{f.remarks}</div>
                  <div className="text-xs text-[#77798a]">{teams.find((t:any)=>t.id===f.teamId)?.name || 'Team'} · {f.phase}</div>
                </div>
              ))}
            </div>
          ) : <div className="mt-3 rounded-xl bg-[#f4f1e8] p-4 text-xs text-[#77798a]">No feedback yet.</div>}
          <Link href="/mentor/feedback" className="mt-3 inline-flex text-xs font-bold text-[#f26a4f]">Submit feedback →</Link>
        </div>
      </div>
    </div>
  )
}
