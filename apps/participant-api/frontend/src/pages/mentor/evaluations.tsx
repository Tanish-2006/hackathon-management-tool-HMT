import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { AlertCircle, ArrowLeft, Loader2, Star } from 'lucide-react';
import { organizerApi } from '@/services/organizerApi';

export default function MentorEvaluations(){
  const [hackathons,setHackathons]=useState<any[]>([]);
  const [selected,setSelected]=useState<string>('');
  const [criteria,setCriteria]=useState<any[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [initial,setInitial]=useState(true);

  useEffect(()=>{
    async function init(){ try{ const l=await organizerApi.listHackathons(); setHackathons(l); if(l[0]) setSelected(l[0].id)}catch(e:any){setError(e.message)} finally{setInitial(false)}}
    init();
  },[]);
  useEffect(()=>{
    if(!selected) return;
    setLoading(true); setError(null);
    organizerApi.listCriteria(selected).then(setCriteria).catch((e:any)=> setError(e.message)).finally(()=> setLoading(false))
  },[selected]);

  if(initial) return <div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/mentor/dashboard" className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] p-2"><ArrowLeft size={16}/></Link>
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">Evaluation criteria</div>
          <h1 className="text-2xl font-bold">Evaluation criteria</h1>
          <p className="text-xs text-[#77798a]">Use these criteria when scoring teams (0-10).</p>
        </div>
      </div>

      <div className="flex gap-3">
        <label className="flex-1 text-sm font-semibold">Hackathon<select value={selected} onChange={e=>setSelected(e.target.value)} className="hmt-input">{hackathons.map(h=> <option key={h.id} value={h.id}>{h.title} — {h.status}</option>)}</select></label>
        <button onClick={()=> selected && organizerApi.listCriteria(selected).then(setCriteria)} className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] px-4 py-3 text-xs font-bold self-end">Refresh</button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2"><AlertCircle size={16}/>{error}</div>}
      {loading && <div className="flex items-center gap-2 text-sm text-[#77798a]"><Loader2 size={16} className="animate-spin"/> Loading criteria…</div>}

      <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
        <h3 className="font-bold flex items-center gap-2"><Star size={16} className="text-[#f26a4f]"/> Criteria · {criteria.length}</h3>
        <p className="mt-1 text-xs text-[#77798a]">Each feedback has one overall score (0-10) plus your comments.</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {criteria.length ? criteria.map((c:any)=>(
            <div key={c.id} className="rounded-xl border border-[#e5e1d7] bg-white p-4 hover:-translate-y-0.5 transition-transform">
              <div className="flex items-center justify-between"><span className="font-bold">{c.name}</span><span className="font-mono text-xs font-bold bg-[#f4f1e8] rounded-full px-2 py-1">{c.weight ? Math.round(c.weight*100)+'%' : '—'} · max {c.maxScore}</span></div>
              <p className="mt-1 text-xs leading-5 text-[#77798a]">{c.description || 'No description'}</p>
              <div className="mt-2 h-2 rounded-full bg-[#f4f1e8]"><div className="h-full rounded-full bg-[#d8e35b]" style={{width:`${Math.round((c.weight||0)*100)}%`}}/></div>
            </div>
          )) : <div className="col-span-2 rounded-xl bg-[#f4f1e8] p-6 text-center text-sm text-[#77798a]">The organizer hasn't added criteria yet.</div>}
        </div>

        <div className="mt-6 rounded-xl bg-[#171a2d] p-4 text-[#fdfbf5]">
          <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">Scoring guidance</div>
          <p className="mt-2 text-sm leading-6 text-[#b9bdca]">Give a score from 0 to 10, explain why, and note strengths and what to improve. You can correct feedback later; the original is kept.</p>
          <Link href="/mentor/feedback" className="mt-3 inline-flex rounded-xl bg-[#d8e35b] px-3 py-2 text-xs font-bold text-[#171a2d]">Submit feedback</Link>
        </div>
      </div>
    </div>
  )
}
