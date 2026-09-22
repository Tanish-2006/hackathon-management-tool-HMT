import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowRight, Calendar, Filter, Layers, MapPin, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { organizerApi, OrganizerApiError } from '@/services/organizerApi';
import { cn } from '@/lib/utils';

function Badge({children,tone='muted'}:any){
  const m:any={ lime:'bg-[#d8e35b] text-[#171a2d]', coral:'bg-[#f26a4f] text-white', blue:'bg-[#5aafbd] text-white', dark:'bg-[#171a2d] text-white', muted:'bg-[#e9e5da] text-[#77798a]' }
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider", m[tone]||m.muted)}>{children}</span>
}

export default function OrganizerHackathons(){
  const [list,setList]=useState<any[]>([]);
  const [q,setQ]=useState('');
  const [filter,setFilter]=useState<string>('All');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);

  useEffect(()=>{
    let m=true;
    async function load(){
      setLoading(true); setError(null);
      try{
        const data = await organizerApi.listHackathons();
        if(!m) return; setList(data);
      }catch(e:any){
        if(!m) return;
        if(e instanceof OrganizerApiError && e.status===403) setError('Organizer role required to list hackathons. Sign in as ORGANIZER or ADMIN.');
        else setError(e.message || 'Failed to load hackathons');
      } finally{ if(m) setLoading(false)}
    }
    load(); return()=>{m=false}
  },[]);

  const filtered = useMemo(()=>{
    return list.filter(h=>{
      const matchesQ = !q || `${h.title} ${h.description} ${h.status}`.toLowerCase().includes(q.toLowerCase());
      const matchesF = filter==='All' || h.status===filter;
      return matchesQ && matchesF;
    })
  },[list,q,filter]);

  if(loading) return <div className="space-y-4"><div className="h-24 animate-pulse rounded-2xl bg-[#e9e5da]"/><div className="grid gap-4 md:grid-cols-3"><div className="h-48 animate-pulse rounded-2xl bg-[#e9e5da]"/><div className="h-48 animate-pulse rounded-2xl bg-[#e9e5da]"/><div className="h-48 animate-pulse rounded-2xl bg-[#e9e5da]"/></div></div>
  if(error) return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 flex gap-3"><AlertCircle size={18}/><div><b>Could not load hackathons</b><p className="mt-1">{error}</p><button onClick={()=>location.reload()} className="mt-3 rounded-lg bg-[#171a2d] px-3 py-1.5 text-xs font-bold text-white">Retry</button></div></div>

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">Organizer · hackathons</div>
          <h1 className="mt-2 text-3xl font-bold tracking-[-.05em] text-[#171a2d]">Hackathons.</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#77798a]">Role-filtered list from GET /hackathons. Organizer sees owned hackathons, ADMIN sees all, MENTOR/PARTICIPANT sees only published — permission-aware.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/organizer/hackathons/quick-create" className="inline-flex items-center gap-2 rounded-xl bg-[#f26a4f] px-4 py-3 text-sm font-bold text-white hover:bg-[#d95341]" data-testid="link-quick-create"><Sparkles size={16}/> Quick AI create <ArrowRight size={14}/></Link>
          <Link href="/organizer/hackathons/create" className="inline-flex items-center gap-2 rounded-xl bg-[#171a2d] px-4 py-3 text-sm font-bold text-white hover:bg-[#252941]"> Create hackathon <ArrowRight size={14}/></Link>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="relative flex-1"><Search size={16} className="absolute left-3 top-3 text-[#aaa9a2]"/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search title, description, status" className="hmt-input pl-10" data-testid="input-search-hackathons"/></label>
        <label className="relative sm:w-48"><Filter size={14} className="absolute left-3 top-3 text-[#aaa9a2]"/><select value={filter} onChange={e=>setFilter(e.target.value)} className="hmt-input pl-9"><option>All</option><option>DRAFT</option><option>REVIEW</option><option>CONFIRMED</option><option>PUBLISHED</option><option>ARCHIVED</option></select></label>
      </div>

      {filtered.length===0 ? (
        <div className="rounded-2xl border border-dashed border-[#dedbd1] p-10 text-center bg-[#fdfbf5]">
          <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-[#f4f1e8]"><Layers size={18}/></div>
          <h3 className="mt-3 font-bold">No hackathons match filter</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-[#77798a]">Try adjusting search or create a new hackathon. AI-generated drafts stay DRAFT — never auto-publish.</p>
          <Link href="/organizer/hackathons/create" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#f26a4f] px-4 py-2 text-xs font-bold text-white">Start wizard</Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((h:any,i:number)=>(
            <motion.div key={h.id} initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} transition={{delay:i*0.04}} className="group relative flex flex-col rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5 hover:-translate-y-1 hover:border-[#f26a4f]/60 transition-all">
              <div className="flex items-center justify-between">
                <Badge tone={h.status==='PUBLISHED'?'lime':h.status==='DRAFT'?'muted':h.status==='REVIEW'?'blue':h.status==='CONFIRMED'?'coral':'dark'}>{h.status}</Badge>
                <span className="font-mono text-[10px] text-[#aaa9a2]">{h.hackathonType || '—'}</span>
              </div>
              <h3 className="mt-5 text-lg font-bold tracking-tight line-clamp-1">{h.title}</h3>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#77798a]">{h.description || 'No description'}</p>
              <div className="mt-4 flex items-center gap-3 text-xs text-[#77798a]"><Calendar size={12}/>{h.duration || '—'} · {h.mode || 'HYBRID'}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(h.themeIds||[]).slice(0,2).map((t:string)=><span key={t} className="rounded-full bg-[#f4f1e8] px-2 py-1 text-[10px] font-semibold">{t.slice(0,8)}</span>)}
                {(h.themeIds?.length||0)>2 && <span className="text-[10px] text-[#77798a]">+{h.themeIds.length-2}</span>}
              </div>
              <div className="mt-4 flex items-center gap-2 border-t border-[#e5e1d7] pt-4">
                <Link href={`/organizer/hackathons/${h.id}`} className="flex-1 rounded-xl bg-[#171a2d] px-3 py-2 text-center text-xs font-bold text-white group-hover:bg-[#252941]">Open workspace <ArrowRight size={12} className="ml-1 inline"/></Link>
                <span className="font-mono text-[10px] text-[#77798a]">v{h.version}</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <div className="rounded-2xl bg-[#171a2d] p-6 text-[#fdfbf5] flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">Guardrail</div>
          <p className="mt-1 text-sm">AI-generated content <b className="text-[#d8e35b]">never automatically publishes</b>. Every draft requires your explicit REVIEW → CONFIRMED → PUBLISHED.</p>
        </div>
        <ShieldCheck size={28} className="text-[#d8e35b] shrink-0"/>
      </div>
    </div>
  )
}
