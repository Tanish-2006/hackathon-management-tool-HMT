import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { motion } from 'framer-motion';
import { ArrowRight, Calendar, MapPin, Layers, Megaphone, Trophy, ShieldCheck, Loader2, AlertCircle, Search, Filter, Clock3 } from 'lucide-react';
import { hmtBackendService, ApiError } from '@/services/backendApi';
import { cn } from '@/lib/utils';

function friendly(e:unknown){ return e instanceof ApiError ? e.message : (e as Error)?.message || 'Failed' }

function Badge({ children, tone='muted' }: any){
  const m:any={ lime:'bg-[#d8e35b] text-[#171a2d]', coral:'bg-[#f26a4f] text-white', blue:'bg-[#5aafbd] text-white', dark:'bg-[#171a2d] text-white', muted:'bg-[#e9e5da] text-[#77798a]' }
  return <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider", m[tone]||m.muted)}>{children}</span>
}

export default function ParticipantHackathons(){
  const [hackathon,setHackathon]=useState<any>(null);
  const [selected,setSelected]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);

  useEffect(()=>{
    let m=true;
    async function load(){
      setLoading(true); setError(null);
      try{
        const cur = await hmtBackendService.getCurrentHackathon();
        if(!m) return;
        setHackathon(cur);
        setSelected(cur);
        if(cur?.id){
          try{ const full = await hmtBackendService.getHackathonById(cur.id); setSelected(full); }catch{}
        }
      }catch(e){ if(m) setError(friendly(e)); }
      finally{ if(m) setLoading(false); }
    }
    load(); return()=>{m=false}
  },[]);

  if(loading) return <div className="space-y-4"><div className="h-24 animate-pulse rounded-2xl bg-[#e9e5da]"/><div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/></div>
  if(error) return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 flex gap-3"><AlertCircle size={18}/><div><b>Could not load hackathons</b><p className="mt-1">{error}</p><button onClick={()=>location.reload()} className="mt-3 rounded-lg bg-[#171a2d] px-3 py-1.5 text-xs font-bold text-white">Retry</button></div></div>

  const phases = selected?.phases || hackathon?.phases || [];
  const criteria = selected?.judgingCriteria || hackathon?.judgingCriteria || [];
  const resources = selected?.resources || hackathon?.resources || [];
  const anns = selected?.announcements || hackathon?.announcements || [];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">Discover - Published only</div>
          <h1 className="mt-2 text-3xl font-bold tracking-[-.05em] text-[#171a2d]">Hackathons</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#77798a]">Published hackathons visible to participants. Drafts stay private to organizers - you only see what is live.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/participant/dashboard" className="rounded-xl border border-[#dedbd1] px-4 py-2 text-xs font-bold">Back to dashboard</Link>
          <a href="#details" className="rounded-xl bg-[#171a2d] px-4 py-2 text-xs font-bold text-white">View details</a>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {hackathon ? (
          <motion.button key={hackathon.id || 'h'} onClick={()=>setSelected(hackathon)} className={cn("text-left rounded-2xl border p-5 transition-all hover:-translate-y-0.5", selected?.id===hackathon.id ? "border-[#f26a4f] bg-[#fdfbf5]" : "border-[#dedbd1] bg-[#fdfbf5] hover:border-[#f26a4f]/50")}>
            <div className="flex items-center justify-between"><Badge tone="lime">PUBLISHED</Badge><ArrowRight size={16} className="text-[#77798a]"/></div>
            <h3 className="mt-6 text-lg font-bold tracking-tight">{hackathon.title || hackathon.name || 'HMT Global AI Hackathon 2026'}</h3>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#77798a]">{hackathon.description}</p>
            <div className="mt-4 flex items-center gap-3 text-xs text-[#77798a]"><Calendar size={12}/>{hackathon.startDate ? new Date(hackathon.startDate).toLocaleDateString() : 'Apr 18-20, 2026'}<MapPin size={12}/>{hackathon.location || 'Online + hubs'}</div>
            <div className="mt-3 flex gap-2">{(hackathon.phases||[]).slice(0,2).map((p:any,idx:number)=><span key={idx} className="rounded-full bg-[#f4f1e8] px-2 py-1 text-[10px] font-bold uppercase">{p.name || p.status}</span>)}</div>
          </motion.button>
        ) : (
          <div className="rounded-2xl border border-dashed border-[#dedbd1] p-8 text-center md:col-span-3"><Layers size={20} className="mx-auto text-[#aaa9a2]"/><p className="mt-2 text-sm font-semibold">No published hackathons</p><p className="text-xs text-[#77798a]">Check back when organizer publishes the next event.</p></div>
        )}
      </div>

      <div id="details" className="grid gap-6 lg:grid-cols-[1.35fr_.65fr]">
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
          <div className="flex items-center justify-between"><h2 className="text-lg font-bold tracking-tight">{selected?.title || 'Hackathon details'}</h2><Badge tone="dark">ID {String(selected?.id||'-').slice(0,8)}</Badge></div>
          <p className="mt-3 text-sm leading-6 text-[#77798a]">{selected?.description || '-'}</p>
          <div className="mt-6 rounded-xl bg-[#f4f1e8] p-4">
            <div className="text-xs font-bold flex items-center gap-2"><ShieldCheck size={14} className="text-[#5aafbd]"/> Problem statement</div>
            <p className="mt-2 text-sm leading-6 text-[#171a2d]">{selected?.problemStatement || 'Build an AI-powered software engineering companion and developer platform.'}</p>
            <div className="mt-3 text-xs text-[#77798a]">Rules: {(selected?.rules || ['Open Source Code','AST Scan compliant','Original work']).join(' - ')}</div>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div><div className="text-xs font-bold">Phases</div><div className="mt-2 space-y-2">{phases.length ? phases.map((p:any,i:number)=><div key={i} className="flex items-center justify-between rounded-xl border border-[#e5e1d7] px-3 py-2 text-xs"><span className="font-semibold">{p.name || 'Phase '+(i+1)}</span><span className={cn("rounded-full px-2 py-1 text-[10px] font-bold", p.status==='ACTIVE'?"bg-[#d8e35b] text-[#171a2d]":"bg-[#e9e5da] text-[#77798a]")}>{p.status}</span></div>) : <div className="text-xs text-[#77798a]">No phases configured</div>}</div></div>
            <div><div className="text-xs font-bold">Judging criteria</div><div className="mt-2 space-y-2">{criteria.length ? criteria.map((c:any,i:number)=><div key={i} className="flex justify-between rounded-xl bg-[#f4f1e8] px-3 py-2 text-xs"><span>{c.name || c.criteria}</span><span className="font-mono font-bold">{c.weight?Math.round(c.weight*100)+'%':'-'}</span></div>) : <div className="text-xs text-[#77798a]">Technical Depth 35% - AI Teammate 35% - UX 30%</div>}</div></div>
          </div>
          <div className="mt-6"><div className="text-xs font-bold">Resources</div><div className="mt-2 grid gap-2 sm:grid-cols-2">{resources.length ? resources.map((r:any,i:number)=><a key={i} href={r.url} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl border border-[#dedbd1] px-3 py-2 text-xs hover:bg-[#f4f1e8]"><span className="font-semibold">{r.name}</span><span className="text-[#5aafbd]">Open</span></a>) : <div className="text-xs text-[#77798a]">Participant API Specs - Neo4j Graph Schema</div>}</div></div>
        </div>
        <div className="space-y-6">
          <div className="rounded-2xl bg-[#171a2d] p-6 text-[#fdfbf5]">
            <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">Announcements - Published only</div>
            <div className="mt-4 space-y-3">
              {anns.length ? anns.map((a:any)=><div key={a.id} className="rounded-xl bg-[#252941] p-3"><div className="text-xs font-bold flex items-center gap-2"><Megaphone size={14} className="text-[#d8e35b]"/>{a.title}</div><p className="mt-1 text-xs leading-5 text-[#b9bdca]">{a.content}</p><div className="mt-2 font-mono text-[10px] text-[#9b9fb1]">{a.createdAt ? new Date(a.createdAt).toLocaleString() : ''}</div></div>) : <div className="rounded-xl bg-[#252941] p-4 text-xs text-[#9b9fb1]">No published announcements yet.</div>}
            </div>
            <div className="mt-4 text-[11px] leading-5 text-[#9b9fb1]">Organizer-only and mentor-only announcements are never exposed to participants.</div>
          </div>
          <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
            <h3 className="font-bold flex items-center gap-2"><Clock3 size={16}/> Key dates</h3>
            <div className="mt-4 space-y-3 text-xs">
              <div className="flex justify-between border-b border-[#e5e1d7] py-2"><span className="text-[#77798a]">Start</span><b>{selected?.startDate ? new Date(selected.startDate).toLocaleString() : '-'}</b></div>
              <div className="flex justify-between border-b border-[#e5e1d7] py-2"><span className="text-[#77798a]">End</span><b>{selected?.endDate ? new Date(selected.endDate).toLocaleString() : '-'}</b></div>
              <div className="flex justify-between py-2"><span className="text-[#77798a]">Submission closes</span><b>18:00 Today</b></div>
            </div>
            <Link href="/participant/projects" className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-[#f26a4f] px-3 py-2 text-xs font-bold text-white">Continue building <ArrowRight size={14}/></Link>
          </div>
        </div>
      </div>
    </div>
  );
}
