import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { AlertCircle, ArrowLeft, Edit2, Loader2, Plus, Trash2, Star, MessageSquare } from 'lucide-react';
import { organizerApi } from '@/services/organizerApi';

export default function OrganizerEvaluations(){
  const [hackathons,setHackathons]=useState<any[]>([]);
  const [selected,setSelected]=useState<string>('');
  const [criteria,setCriteria]=useState<any[]>([]);
  const [feedbacks,setFeedbacks]=useState<any[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [success,setSuccess]=useState<string|null>(null);
  const [form,setForm]=useState({name:'',desc:'',weight:0.25,max:10});
  const [initial,setInitial]=useState(true);

  useEffect(()=>{
    async function init(){ try{ const l=await organizerApi.listHackathons(); setHackathons(l); if(l[0]) setSelected(l[0].id)}catch(e:any){setError(e.message)} finally{setInitial(false)}}
    init();
  },[]);
  useEffect(()=>{
    if(!selected) return;
    setLoading(true); setError(null);
    Promise.allSettled([
      organizerApi.listCriteria(selected).then(setCriteria).catch(()=>setCriteria([])),
      organizerApi.listFeedbacks(selected).then(setFeedbacks).catch(()=>setFeedbacks([])),
    ]).finally(()=> setLoading(false))
  },[selected]);

  const add = async()=>{
    if(!selected){ setError('Select hackathon'); return}
    if(!form.name.trim()){ setError('Name required'); return}
    setLoading(true); setError(null); setSuccess(null);
    try{
      const c=await organizerApi.createCriteria(selected, {name:form.name, description:form.desc||undefined, weight:Number(form.weight), maxScore:Number(form.max)});
      setCriteria(prev=>[...prev,c]); setSuccess(`Criteria "${c.name}" created`); setForm({name:'',desc:'',weight:0.25,max:10});
    }catch(e:any){ setError(e.message)} finally{ setLoading(false)}
  }
  const remove = async(id:string)=>{
    if(!confirm('Delete criteria?')) return;
    try{ await organizerApi.deleteCriteria(id); setCriteria(prev=>prev.filter(x=>x.id!==id)); setSuccess('Deleted')}catch(e:any){ setError(e.message)}
  }
  const edit = async(c:any)=>{
    const name=prompt('Edit name',c.name); if(name===null) return;
    if(!name.trim()){ setError('Criteria name cannot be empty.'); return; }
    const w=prompt('Weight 0.01-1', String(c.weight)); if(w===null) return;
    const weight=Number(w);
    if(!Number.isFinite(weight) || weight<0.01 || weight>1){ setError('Weight must be a number between 0.01 and 1.'); return; }
    try{ const updated=await organizerApi.updateCriteria(c.id,{name:name.trim(),weight}); setCriteria(prev=>prev.map(x=>x.id===c.id?updated:x)); setSuccess('Updated')}catch(e:any){ setError(e.message)}
  }

  if(initial) return <div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/organizer/dashboard" aria-label="Back" title="Back" className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] p-2"><ArrowLeft size={16}/></Link>
        <div>
                    <h1 className="text-2xl font-bold">Evaluations</h1>
        </div>
      </div>

      <div className="flex gap-3">
        <label className="flex-1 text-sm font-semibold">Hackathon<select value={selected} onChange={e=>setSelected(e.target.value)} className="hmt-input">{hackathons.map(h=> <option key={h.id} value={h.id}>{h.title} — {h.status}</option>)}</select></label>
        <button onClick={()=>{ if(selected) { setLoading(true); Promise.all([organizerApi.listCriteria(selected).then(setCriteria), organizerApi.listFeedbacks(selected).then(setFeedbacks)]).finally(()=>setLoading(false))}}} className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] px-4 py-3 text-xs font-bold self-end">Refresh</button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2"><AlertCircle size={16}/>{error}<button onClick={()=>setError(null)} className="ml-auto text-xs font-bold">×</button></div>}
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 flex gap-2"><Star size={16}/>{success}<button onClick={()=>setSuccess(null)} className="ml-auto text-xs font-bold">×</button></div>}
      {loading && <div className="flex items-center gap-2 text-sm text-[#77798a]"><Loader2 size={16} className="animate-spin"/> Loading…</div>}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
          <h3 className="font-bold flex items-center gap-2"><Star size={16} className="text-[#f26a4f]"/> Evaluation criteria · {criteria.length}</h3>
          <p className="mt-1 text-xs text-[#77798a]">Weights should add up to 1.</p>

          <div className="mt-4 rounded-xl bg-[#f4f1e8] p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-semibold">Name*<input value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} placeholder="Innovation" className="hmt-input"/></label>
              <label className="text-sm font-semibold">Weight (0.01-1)<input type="number" step="0.05" value={form.weight} onChange={e=>setForm(p=>({...p,weight:parseFloat(e.target.value)||0}))} className="hmt-input"/></label>
              <label className="text-sm font-semibold">Description<input value={form.desc} onChange={e=>setForm(p=>({...p,desc:e.target.value}))} placeholder="Creative thinking" className="hmt-input"/></label>
              <label className="text-sm font-semibold">Max score<input type="number" value={form.max} onChange={e=>setForm(p=>({...p,max:parseInt(e.target.value)||10}))} className="hmt-input"/></label>
            </div>
            <button onClick={add} disabled={loading} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50 flex items-center gap-1"><Plus size={14}/> Add criteria</button>
          </div>

          <div className="mt-4 space-y-2">
            {criteria.length ? criteria.map((c:any)=><div key={c.id} className="flex items-center justify-between rounded-xl border border-[#e5e1d7] bg-white px-3 py-2.5">
              <div><div className="text-sm font-bold">{c.name}</div><div className="text-xs text-[#77798a]">{c.description || '—'} · weight {c.weight} · max {c.maxScore}</div></div>
              <div className="flex gap-1">
                <button onClick={()=>edit(c)} aria-label={`Edit ${c.name}`} title="Edit" className="rounded-lg border border-[#dedbd1] p-2"><Edit2 size={14}/></button>
                <button onClick={()=>remove(c.id)} aria-label={`Delete ${c.name}`} title="Delete" className="rounded-lg border border-[#dedbd1] p-2 text-[#f26a4f]"><Trash2 size={14}/></button>
              </div>
            </div>) : <div className="rounded-xl bg-[#f4f1e8] p-4 text-xs text-[#77798a]">No criteria yet.</div>}
          </div>
        </div>

        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
          <h3 className="font-bold flex items-center gap-2"><MessageSquare size={16} className="text-[#5aafbd]"/> Mentor feedback · {feedbacks.length}</h3>
          <p className="mt-1 text-xs text-[#77798a]">Participants only see feedback after you publish it.</p>

          <div className="mt-4 space-y-3 max-h-[520px] overflow-auto pr-1">
            {feedbacks.length ? feedbacks.map((f:any)=>(
              <div key={f.id} className="rounded-xl border border-[#e5e1d7] bg-white p-4">
                <div className="flex items-start justify-between">
                  <div><div className="text-sm font-bold">Score {f.score} · {f.remarks?.slice(0,40)}</div><div className="text-xs text-[#77798a]">{f.phase}</div></div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${f.publicationStatus==='PUBLISHED'?'bg-[#d8e35b] text-[#171a2d]': f.publicationStatus==='ORGANIZER_REVIEWED'?'bg-[#5aafbd] text-white':'bg-[#e9e5da] text-[#77798a]'}`}>{f.publicationStatus}</span>
                </div>
                <div className="mt-2 text-xs leading-5"><b>Reason:</b> {f.reason}</div>
                {f.strengths?.length>0 && <div className="mt-1 text-xs"><b>Strengths:</b> {f.strengths.join(', ')}</div>}
                {f.weaknesses?.length>0 && <div className="mt-1 text-xs text-[#77798a]"><b>Weaknesses:</b> {f.weaknesses.join(', ')}</div>}
                <div className="mt-1 text-xs text-[#77798a]">Tech: {f.technicalFeedback || '—'} · Product: {f.productFeedback || '—'}</div>
                <div className="mt-2 flex gap-2">
                  <Link href="/organizer/feedback" className="rounded-lg bg-[#171a2d] px-2 py-1 text-xs font-bold text-white">Review</Link>
                  <button onClick={async()=>{ try{ const vs=await organizerApi.listFeedbackVersions(f.id); alert(`${vs.length} versions: ${vs.map((v:any)=> 'v'+v.version).join(', ')}`)}catch(e:any){alert(e.message)}}} className="rounded-lg border border-[#dedbd1] px-2 py-1 text-xs font-semibold">Versions</button>
                </div>
              </div>
            )) : <div className="rounded-xl bg-[#f4f1e8] p-4 text-xs text-[#77798a]">No feedback yet.</div>}
          </div>

          <Link href="/organizer/feedback" className="mt-4 inline-flex text-xs font-bold text-[#f26a4f]">Review feedback →</Link>
        </div>
      </div>
    </div>
  )
}
