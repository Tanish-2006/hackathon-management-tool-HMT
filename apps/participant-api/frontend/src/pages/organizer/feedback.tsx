import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, Eye, Lock, ShieldCheck, Loader2, FileText } from 'lucide-react';
import { organizerApi, OrganizerApiError } from '@/services/organizerApi';

function StatusBadge({s}:{s:string}){
  const m:any={ MENTOR_SUBMITTED:'bg-[#e9e5da] text-[#77798a]', ORGANIZER_REVIEWED:'bg-[#5aafbd] text-white', PUBLISHED:'bg-[#d8e35b] text-[#171a2d]' };
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${m[s]||'bg-[#e9e5da]'}`}>{s}</span>
}

export default function OrganizerFeedback(){
  const [hackathons,setHackathons]=useState<any[]>([]);
  const [selected,setSelected]=useState<string>('');
  const [feedbacks,setFeedbacks]=useState<any[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [success,setSuccess]=useState<string|null>(null);
  const [versions,setVersions]=useState<Record<string,any[]>>({});
  const [initial,setInitial]=useState(true);

  useEffect(()=>{
    async function init(){ try{ const l=await organizerApi.listHackathons(); setHackathons(l); if(l[0]) setSelected(l[0].id)}catch(e:any){setError(e.message)} finally{setInitial(false)}}
    init();
  },[]);
  const refresh=async()=>{
    if(!selected) return;
    setLoading(true); setError(null);
    try{ const list=await organizerApi.listFeedbacks(selected); setFeedbacks(list)}catch(e:any){ setError(e.message)} finally{ setLoading(false)}
  }
  useEffect(()=>{ if(selected) refresh()},[selected]);

  const doReview=async(id:string)=>{
    setLoading(true); setError(null); setSuccess(null);
    try{ const r=await organizerApi.reviewFeedback(id); setFeedbacks(prev=>prev.map(f=> f.id===id?r:f)); setSuccess('Feedback reviewed.')}catch(e:any){ setError(e.message)} finally{ setLoading(false)}
  }
  const doPublish=async(id:string)=>{
    setLoading(true); setError(null);
    try{ const r=await organizerApi.publishFeedback(id); setFeedbacks(prev=>prev.map(f=> f.id===id?r:f)); setSuccess('Feedback published. Participants can now see it.')}catch(e:any){ setError(e.message)} finally{ setLoading(false)}
  }
  const loadVersions=async(id:string)=>{
    try{ const vs=await organizerApi.listFeedbackVersions(id); setVersions(prev=>({...prev,[id]:vs}))}catch(e:any){ setError(e.message)}
  }

  if(initial) return <div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/organizer/dashboard" aria-label="Back" title="Back" className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] p-2"><ArrowLeft size={16}/></Link>
        <div>
                    <h1 className="text-2xl font-bold">Feedback</h1>
          <p className="text-xs text-[#77798a]">Review mentor feedback, then publish it to participants.</p>
        </div>
      </div>

      <div className="flex gap-3">
        <label className="flex-1 text-sm font-semibold">Hackathon<select value={selected} onChange={e=>setSelected(e.target.value)} className="hmt-input">{hackathons.map(h=> <option key={h.id} value={h.id}>{h.title} — {h.status}</option>)}</select></label>
        <button onClick={refresh} className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] px-4 py-3 text-xs font-bold self-end">Refresh</button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2"><AlertCircle size={16}/>{error}<button onClick={()=>setError(null)} className="ml-auto text-xs font-bold">×</button></div>}
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 flex gap-2"><CheckCircle2 size={16}/>{success}<button onClick={()=>setSuccess(null)} className="ml-auto text-xs font-bold">×</button></div>}

      <div className="rounded-2xl bg-[#171a2d] p-5 text-[#fdfbf5] flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-xs"><ShieldCheck size={16} className="text-[#d8e35b]"/><span className="font-bold">Workflow</span><span className="text-[#9b9fb1]">Mentor submits → you review → you publish → participants see it.</span></div>
        <Link href="/organizer/evaluations" className="rounded-xl border border-[#2a2e45] px-3 py-2 text-xs font-semibold">Criteria</Link>
      </div>

      {loading && <div className="flex items-center gap-2 text-sm text-[#77798a]"><Loader2 size={16} className="animate-spin"/> Loading feedbacks…</div>}

      {!loading && feedbacks.length===0 ? (
        <div className="rounded-2xl border border-dashed border-[#dedbd1] bg-[#fdfbf5] p-8 text-center">
          <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-[#f4f1e8]"><FileText size={18}/></div>
          <h3 className="mt-3 font-bold">No feedback yet</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-[#77798a]">Feedback from mentors will show up here for you to review and publish.</p>
        </div>
      ) : null}

      <div className="grid gap-4">
        {feedbacks.map((f:any)=>(
          <div key={f.id} className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2"><span className="font-bold">Score {f.score}/10</span><StatusBadge s={f.publicationStatus}/><span className="font-mono text-[11px] text-[#77798a]">v{f.version} · {f.phase}</span></div>
                <div className="mt-1 text-sm font-semibold">{f.remarks}</div>
                <div className="text-xs text-[#77798a]">Reason: {f.reason}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={()=>doReview(f.id)} disabled={loading || f.publicationStatus!=='MENTOR_SUBMITTED'} className="rounded-xl bg-[#5aafbd] px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Review</button>
                <button onClick={()=>doPublish(f.id)} disabled={loading || f.publicationStatus!=='ORGANIZER_REVIEWED'} className="rounded-xl bg-[#d8e35b] px-3 py-2 text-xs font-bold text-[#171a2d] disabled:opacity-40">Publish</button>
                <button onClick={()=>loadVersions(f.id)} className="rounded-xl border border-[#dedbd1] px-3 py-2 text-xs font-semibold">Versions</button>
              </div>
            </div>

            {(f.strengths?.length>0 || f.weaknesses?.length>0) && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2 text-xs">
                <div className="rounded-xl bg-[#f4f1e8] p-3"><b>Strengths:</b> {f.strengths?.join(', ') || '—'}</div>
                <div className="rounded-xl bg-[#f4f1e8] p-3"><b>Weaknesses:</b> {f.weaknesses?.join(', ') || '—'}</div>
              </div>
            )}
            <div className="mt-2 grid gap-2 sm:grid-cols-2 text-xs">
              <div className="rounded-xl bg-white border border-[#e5e1d7] p-3"><b>Technical:</b> {f.technicalFeedback || '—'}</div>
              <div className="rounded-xl bg-white border border-[#e5e1d7] p-3"><b>Product:</b> {f.productFeedback || '—'}</div>
            </div>
            {f.recommendation && <div className="mt-2 text-xs"><b>Recommendation:</b> {f.recommendation}</div>}

            {versions[f.id] && (
              <div className="mt-3 rounded-xl bg-[#f4f1e8] p-3">
                <div className="text-xs font-bold flex items-center gap-1"><Clock3 size={14}/> Versions ({versions[f.id].length})</div>
                <div className="mt-2 space-y-1.5">
                  {versions[f.id].map((v:any)=>(
                    <div key={v.id} className="flex justify-between rounded-lg bg-white px-2 py-1.5 text-xs border border-[#e5e1d7]">
                      <span><b>v{v.version}</b> {v.isCorrection ? '(correction)' : '(original)'} · score {v.score}</span>
                      <span className="text-[#77798a]">{new Date(v.createdAt).toLocaleTimeString()} · {v.publicationStatus}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
