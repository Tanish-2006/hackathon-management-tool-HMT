import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { AlertCircle, ArrowRight, Award, Calendar, Clock3, Layers, Loader2, ShieldCheck, Users } from 'lucide-react';
import { motion } from 'framer-motion';
import { organizerApi, OrganizerApiError } from '@/services/organizerApi';

function Badge({children,tone='muted'}:any){ const m:any={ lime:'bg-[#d8e35b] text-[#171a2d]', coral:'bg-[#f26a4f] text-white', blue:'bg-[#5aafbd] text-white', dark:'bg-[#171a2d] text-white', muted:'bg-[#e9e5da] text-[#77798a]' }; return <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${m[tone]||m.muted}`}>{children}</span> }
function Card({children,className=''}:{children:React.ReactNode;className?:string}){ return <div className={`rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] ${className}`}>{children}</div> }

export default function MentorDashboard(){
  const [me,setMe]=useState<any|null>(null);
  const [teams,setTeams]=useState<any[]>([]);
  const [hackathon,setHackathon]=useState<any|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);

  useEffect(()=>{
    let m=true;
    async function load(){
      setLoading(true); setError(null);
      try{
        const meData = await organizerApi.getMe();
        if(!m) return; setMe(meData);
        const mentorId = (meData as any).id || (meData as any).user?.id;
        if(!mentorId){ setError('Could not load your mentor account.'); return}
        const list = await organizerApi.listMentorTeams(mentorId).catch(()=>[]);
        if(!m) return; setTeams(list);
        if(list[0]?.hackathonId){
          try{ const h=await organizerApi.getHackathon(list[0].hackathonId); if(m) setHackathon(h)}catch{}
        } else {
          try{ const hs=await organizerApi.listHackathons(); if(m && hs[0]) setHackathon(hs[0])}catch{}
        }
      }catch(e:any){
        if(!m) return;
        if(e instanceof OrganizerApiError && e.status===401) setError('Your session expired. Please sign in again.');
        else if(e instanceof OrganizerApiError && e.status===403) setError('This page is for mentors.');
        else setError(e.message)
      } finally{ if(m) setLoading(false)}
    }
    load(); return()=>{m=false}
  },[]);

  if(loading) return <div className="space-y-4"><div className="h-24 animate-pulse rounded-2xl bg-[#e9e5da]"/><div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/></div>
  if(error) return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 flex gap-3"><AlertCircle size={18}/><div><b>Could not load mentor dashboard</b><p className="mt-1">{error}</p><div className="mt-3 flex gap-2"><button onClick={()=>location.reload()} className="rounded-lg bg-[#171a2d] px-3 py-1.5 text-xs font-bold text-white">Retry</button><Link href="/login" className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-[#171a2d]">Sign in</Link></div></div></div>

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">Mentor workspace</div>
          <h1 className="mt-2 text-3xl font-bold tracking-[-.05em]">Your teams, your impact.</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#77798a]">The teams you mentor and the feedback you give.</p>
        </div>
        <Link href="/mentor/feedback" className="inline-flex items-center gap-2 rounded-xl bg-[#171a2d] px-4 py-3 text-sm font-bold text-white hover:bg-[#252941]">Submit feedback <ArrowRight size={14}/></Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5"><div className="flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-wider text-[#77798a]">Mentor</span><ShieldCheck size={14} className="text-[#5aafbd]"/></div><div className="mt-3 font-bold">{me?.email || me?.user?.email || '—'} </div><div className="text-xs text-[#77798a]">Mentor</div></div>
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5"><div className="font-mono text-[10px] uppercase tracking-wider text-[#77798a]">Assigned teams</div><div className="mt-3 text-2xl font-bold">{teams.length}</div></div>
        <div className="rounded-2xl bg-[#d8e35b] p-5"><div className="font-mono text-[10px] uppercase tracking-wider text-[#596027]">Hackathon</div><div className="mt-2 font-bold text-[#171a2d] line-clamp-1">{hackathon?.title || 'No hackathon yet'}</div><div className="text-xs text-[#596027]">{hackathon?.status || '—'} · {hackathon?.mode || ''}</div></div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_.6fr]">
        <Card className="p-6">
          <div className="flex items-center justify-between"><h3 className="font-bold flex items-center gap-2"><Users size={16} className="text-[#f26a4f]"/> Assigned teams</h3><Badge tone="dark">{teams.length} teams</Badge></div>
          {teams.length ? (
            <div className="mt-4 space-y-3">
              {teams.map((t:any,i:number)=>(
                <motion.div key={t.id || i} initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} transition={{delay:i*0.04}} className="flex items-center gap-3 rounded-xl border border-[#e5e1d7] bg-white p-4 hover:-translate-y-0.5 transition-transform">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e9e5da] text-xs font-bold">{(t.name || 'TE').slice(0,2).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-sm line-clamp-1">{t.name || 'Unnamed team'}</div>
                    <div className="text-xs text-[#77798a]">{t.memberCount ?? t.members?.length ?? 0} members · {t.project?.title ? `Project: ${t.project.title}` : 'No project yet'}</div>
                  </div>
                  <Link href="/mentor/feedback" className="rounded-full bg-[#f26a4f] px-3 py-1.5 text-xs font-bold text-white">Feedback</Link>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-xl bg-[#f4f1e8] p-6 text-center">
              <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-[#e9e5da]"><Layers size={18}/></div>
              <h4 className="mt-3 font-bold">No teams assigned yet</h4>
              <p className="mt-1 text-sm text-[#77798a]">Teams appear here once an organizer assigns you.</p>
              <Link href="/organizer/mentors" className="mt-3 inline-flex text-xs font-bold text-[#f26a4f]">Organizer view →</Link>
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <Link href="/mentor/teams" className="flex-1 rounded-xl bg-[#171a2d] px-3 py-2 text-center text-xs font-bold text-white">View all teams</Link>
            <Link href="/mentor/evaluations" className="rounded-xl border border-[#dedbd1] px-3 py-2 text-xs font-semibold">Evaluations</Link>
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="p-6">
            <h3 className="font-bold flex items-center gap-2"><Calendar size={16}/> Hackathon context</h3>
            {hackathon ? (
              <div className="mt-3 space-y-3">
                <div className="rounded-xl bg-[#f4f1e8] p-4">
                  <div className="text-sm font-bold">{hackathon.title}</div>
                  <p className="mt-1 text-xs leading-5 text-[#77798a] line-clamp-3">{hackathon.description}</p>
                  <div className="mt-2 text-xs"><b>Type:</b> {hackathon.hackathonType} · {hackathon.mode} · {hackathon.duration}</div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 text-xs">
                  <div className="rounded-xl bg-white border border-[#e5e1d7] p-3"><div className="font-bold">Problem statement</div><div className="mt-1 text-[#77798a] line-clamp-3">{hackathon.problemStatement || 'Open innovation — broad objective'}</div></div>
                  <div className="rounded-xl bg-white border border-[#e5e1d7] p-3"><div className="font-bold">Status</div><div className="mt-1"><Badge tone={hackathon.status==='PUBLISHED'?'lime':'muted'}>{hackathon.status}</Badge></div><div className="mt-1 text-[#77798a]">v{hackathon.version}</div></div>
                </div>
                <Link href="/mentor/teams" className="inline-flex items-center gap-1 text-xs font-bold text-[#5aafbd]">See team context <ArrowRight size={12}/></Link>
              </div>
            ) : <div className="mt-3 text-xs text-[#77798a]">No hackathon context available.</div>}
          </Card>

          <div className="rounded-2xl bg-[#171a2d] p-6 text-[#fdfbf5]">
            <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">Your guidance</div>
            <h3 className="mt-2 font-bold">Score with clarity.</h3>
            <p className="mt-2 text-sm leading-6 text-[#b9bdca]">Share a score, what went well, and what to improve.</p>
            <Link href="/mentor/feedback" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#d8e35b] px-3 py-2 text-xs font-bold text-[#171a2d]">Open feedback <ArrowRight size={14}/></Link>
          </div>
        </div>
      </div>
    </div>
  )
}
