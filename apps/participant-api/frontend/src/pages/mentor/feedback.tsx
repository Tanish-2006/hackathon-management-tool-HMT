import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, Layers, Loader2, Lock, Send, ShieldCheck } from 'lucide-react';
import { organizerApi, OrganizerApiError } from '@/services/organizerApi';

function Field({label,required,children}:{label:string;required?:boolean;children:React.ReactNode}){
  return <label className="block text-sm font-semibold">{label}{required && <span className="ml-1 text-[#f26a4f]">*</span>}<div className="mt-1.5">{children}</div></label>
}

export default function MentorFeedback(){
  const [hackathons,setHackathons]=useState<any[]>([]);
  const [selectedHack,setSelectedHack]=useState<string>('');
  const [teams,setTeams]=useState<any[]>([]);
  const [feedbacks,setFeedbacks]=useState<any[]>([]);
  const [me,setMe]=useState<any|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [success,setSuccess]=useState<string|null>(null);
  const [form,setForm]=useState({
    teamId:'', projectId:'', hackathonId:'', score:7, remarks:'', reason:'', strengths:'', weaknesses:'', technicalFeedback:'', productFeedback:'', recommendation:'', phase:'development'
  });
  const [correctId,setCorrectId]=useState<string>('');
  const [correctForm,setCorrectForm]=useState({score:'', remarks:'', reason:''});
  const [versions,setVersions]=useState<Record<string,any[]>>({});
  const [initial,setInitial]=useState(true);

  const update=(k:string,v:any)=> setForm(p=>({...p,[k]:v}));

  useEffect(()=>{
    async function init(){
      try{
        const meData = await organizerApi.getMe(); setMe(meData);
        const list = await organizerApi.listHackathons(); setHackathons(list);
        if(list[0]) {setSelectedHack(list[0].id); update('hackathonId', list[0].id); }
        // try to get mentor teams to auto-fill
        const mentorId=(meData as any).id || (meData as any).user?.id;
        if(mentorId){
          const t=await organizerApi.listMentorTeams(mentorId).catch(()=>[]);
          setTeams(t as any);
          if(t[0]) { update('teamId', (t[0] as any).id); update('projectId', (t[0] as any).project?.id || (t[0] as any).projectId || ''); }
        }
      }catch(e:any){ setError(e.message)} finally{ setInitial(false)}
    }
    init();
  },[]);
  useEffect(()=>{
    if(!selectedHack) return;
    organizerApi.listFeedbacks(selectedHack).then(setFeedbacks).catch(()=> setFeedbacks([]));
    // also if we have no teams for this hackathon, try to fetch assignments? mentor teams already fetched
  },[selectedHack]);

  useEffect(()=>{ if(selectedHack) update('hackathonId', selectedHack)},[selectedHack]);

  const submit=async()=>{
    setError(null); setSuccess(null);
    const required=['teamId','hackathonId','remarks','reason','phase'];
    for(const k of required){ if(!(form as any)[k]?.toString().trim()){ setError(`Field ${k} is required`); return}}
    if(form.score<0 || form.score>10){ setError('Score must be 0-10'); return}
    setLoading(true);
    try{
      const payload:any={
        teamId: form.teamId,
        projectId: form.projectId || null,
        hackathonId: form.hackathonId,
        score: Number(form.score),
        remarks: form.remarks,
        reason: form.reason,
        strengths: form.strengths.split(',').map(s=>s.trim()).filter(Boolean),
        weaknesses: form.weaknesses.split(',').map(s=>s.trim()).filter(Boolean),
        technicalFeedback: form.technicalFeedback || null,
        productFeedback: form.productFeedback || null,
        recommendation: form.recommendation || null,
        phase: form.phase,
      };
      const res=await organizerApi.submitFeedback(payload);
      setFeedbacks(prev=>[res, ...prev]);
      setSuccess(`Feedback submitted v${res.version} — MENTOR_SUBMITTED (awaits organizer review)`);
      setForm(p=>({...p, remarks:'', reason:'', score:7, strengths:'', weaknesses:'', technicalFeedback:'', productFeedback:'', recommendation:''}));
    }catch(e:any){ setError(e.message)} finally{ setLoading(false)}
  }

  const doCorrect=async()=>{
    if(!correctId){ setError('Select feedback id to correct'); return}
    setLoading(true); setError(null); setSuccess(null);
    try{
      const data:any={};
      if(correctForm.score) data.score=Number(correctForm.score);
      if(correctForm.remarks) data.remarks=correctForm.remarks;
      if(correctForm.reason) data.reason=correctForm.reason;
      if(Object.keys(data).length===0){ setError('Provide at least one correction field'); setLoading(false); return}
      const res=await organizerApi.correctFeedback(correctId, data);
      setFeedbacks(prev=>[res, ...prev.filter(x=>x.id!==res.id)]);
      setSuccess(`Corrected → new version v${res.version} (parent ${correctId.slice(0,8)})`);
      setCorrectId(''); setCorrectForm({score:'',remarks:'',reason:''});
    }catch(e:any){ setError(e.message)} finally{ setLoading(false)}
  }

  const loadVersions=async(id:string)=>{
    try{ const vs=await organizerApi.listFeedbackVersions(id); setVersions(p=>({...p,[id]:vs}))}catch(e:any){ setError(e.message)}
  }
  const tryImmutable=async(id:string)=>{
    setError(null); setSuccess(null);
    try{ await organizerApi.illegalUpdateFeedback(id,{remarks:'hack'}); setSuccess('Unexpected: PUT succeeded (should be 403)')}catch(e:any){
      if(e instanceof OrganizerApiError && e.status===403) setError(`✓ Immutable: 403 ${e.message}`)
      else setError(e.message)
    }
  }

  if(initial) return <div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/mentor/dashboard" className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] p-2"><ArrowLeft size={16}/></Link>
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">Mentor · feedback</div>
          <h1 className="text-2xl font-bold">Submit feedback</h1>
          <p className="text-xs text-[#77798a]">POST /mentor/feedback · Correct via POST /mentor/feedback/:id/correct · Immutable check PUT → 403 · Versions</p>
        </div>
      </div>

      <div className="flex gap-3">
        <label className="flex-1 text-sm font-semibold">Hackathon<select value={selectedHack} onChange={e=>setSelectedHack(e.target.value)} className="hmt-input">{hackathons.map(h=> <option key={h.id} value={h.id}>{h.title} — {h.status}</option>)}</select></label>
        <label className="flex-1 text-sm font-semibold">Team<select value={form.teamId} onChange={e=>update('teamId',e.target.value)} className="hmt-input"><option value="">Select team</option>{teams.map((t:any)=> <option key={t.id} value={t.id}>{t.name || t.id.slice(0,12)}</option>)}</select></label>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2"><AlertCircle size={16} className="shrink-0 mt-0.5"/>{error}<button onClick={()=>setError(null)} className="ml-auto text-xs font-bold">×</button></div>}
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 flex gap-2"><CheckCircle2 size={16} className="shrink-0 mt-0.5"/>{success}<button onClick={()=>setSuccess(null)} className="ml-auto text-xs font-bold">×</button></div>}

      <div className="grid gap-6 lg:grid-cols-[1.5fr_.7fr]">
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6 sm:p-7">
          <h3 className="font-bold">New feedback</h3>
          <p className="mt-1 text-xs text-[#77798a]">Mentor can only submit for assigned teams. If you are not assigned, request organizer assignment.</p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Team id" required><input value={form.teamId} onChange={e=>update('teamId',e.target.value)} placeholder="team_xxx" className="hmt-input"/></Field>
            <Field label="Project id"><input value={form.projectId} onChange={e=>update('projectId',e.target.value)} placeholder="(optional) project id" className="hmt-input"/></Field>
            <Field label="Hackathon id" required><input value={form.hackathonId} onChange={e=>update('hackathonId',e.target.value)} className="hmt-input font-mono text-xs"/></Field>
            <Field label="Phase" required><select value={form.phase} onChange={e=>update('phase',e.target.value)} className="hmt-input"><option>registration</option><option>team_formation</option><option>ideation</option><option>development</option><option>evaluation</option><option>submission</option><option>finale</option><option>results</option></select></Field>
            <Field label="Score (0-10)" required><input type="number" min={0} max={10} step={0.5} value={form.score} onChange={e=>update('score',parseFloat(e.target.value)||0)} className="hmt-input"/></Field>
            <Field label="Recommendation"><input value={form.recommendation} onChange={e=>update('recommendation',e.target.value)} placeholder="Advance to finale" className="hmt-input"/></Field>
          </div>

          <div className="mt-4 space-y-4">
            <Field label="Remarks" required><textarea value={form.remarks} onChange={e=>update('remarks',e.target.value)} rows={2} placeholder="Great work on architecture…" className="hmt-input resize-none"/></Field>
            <Field label="Reason" required><textarea value={form.reason} onChange={e=>update('reason',e.target.value)} rows={2} placeholder="Clean code and scalable design…" className="hmt-input resize-none"/></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Strengths (comma)"><input value={form.strengths} onChange={e=>update('strengths',e.target.value)} placeholder="Architecture, Teamwork" className="hmt-input"/></Field>
              <Field label="Weaknesses (comma)"><input value={form.weaknesses} onChange={e=>update('weaknesses',e.target.value)} placeholder="Documentation lacking" className="hmt-input"/></Field>
              <Field label="Technical feedback"><textarea value={form.technicalFeedback} onChange={e=>update('technicalFeedback',e.target.value)} rows={2} className="hmt-input resize-none" placeholder="Consider caching…"/></Field>
              <Field label="Product feedback"><textarea value={form.productFeedback} onChange={e=>update('productFeedback',e.target.value)} rows={2} className="hmt-input resize-none" placeholder="Improve onboarding…"/></Field>
            </div>
          </div>

          <button onClick={submit} disabled={loading} className="mt-5 w-full rounded-xl bg-[#171a2d] px-4 py-3 text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2">{loading ? <Loader2 size={16} className="animate-spin"/> : <Send size={16}/>} Submit feedback (MENTOR)</button>
          <div className="mt-2 text-[11px] text-[#77798a] text-center">Submits as MENTOR_SUBMITTED — organizer will review → publish to make visible to participants.</div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5">
            <h3 className="font-bold text-sm flex items-center gap-2"><Clock3 size={16}/> Correct (new version)</h3>
            <p className="mt-1 text-xs text-[#77798a]">Original is immutable. Correct via POST /mentor/feedback/:id/correct (creates v+1 with parentId).</p>
            <div className="mt-3 space-y-3">
              <Field label="Feedback id to correct"><select value={correctId} onChange={e=>setCorrectId(e.target.value)} className="hmt-input font-mono text-xs"><option value="">Select feedback</option>{feedbacks.map((f:any)=> <option key={f.id} value={f.id}>v{f.version} {f.id.slice(0,8)} — {f.remarks.slice(0,20)}</option>)}</select></Field>
              <Field label="New score"><input type="number" value={correctForm.score} onChange={e=>setCorrectForm(p=>({...p,score:e.target.value}))} placeholder="8.5" className="hmt-input"/></Field>
              <Field label="New remarks"><input value={correctForm.remarks} onChange={e=>setCorrectForm(p=>({...p,remarks:e.target.value}))} placeholder="Corrected remarks" className="hmt-input"/></Field>
              <Field label="New reason"><input value={correctForm.reason} onChange={e=>setCorrectForm(p=>({...p,reason:e.target.value}))} placeholder="Corrected reason" className="hmt-input"/></Field>
              <button onClick={doCorrect} disabled={loading} className="w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-xs font-bold disabled:opacity-50">Create correction</button>
            </div>
          </div>

          <div className="rounded-2xl bg-[#171a2d] p-5 text-[#fdfbf5]">
            <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">Guardrails</div>
            <p className="mt-2 text-xs leading-5 text-[#b9bdca]">Original mentor record is immutable. Direct PUT → 403. View versions per feedback. Unpublished feedback is hidden from participants.</p>
            <div className="mt-3 rounded-xl bg-[#252941] p-3 text-xs"><div className="font-bold">Your mentor id</div><div className="font-mono text-[11px] text-[#9b9fb1]">{(me as any)?.id || (me as any)?.user?.id || '—'}</div></div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
        <h3 className="font-bold">Your recent feedbacks · {feedbacks.length}</h3>
        {feedbacks.length===0 ? <div className="mt-3 rounded-xl bg-[#f4f1e8] p-4 text-xs text-[#77798a]">No feedbacks for this hackathon yet.</div> : (
          <div className="mt-3 space-y-3">
            {feedbacks.slice(0,6).map((f:any)=>(
              <div key={f.id} className="rounded-xl border border-[#e5e1d7] bg-white p-4">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm">Score {f.score} · v{f.version} · {f.phase}</span>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${f.publicationStatus==='PUBLISHED'?'bg-[#d8e35b] text-[#171a2d]': f.publicationStatus==='ORGANIZER_REVIEWED'?'bg-[#5aafbd] text-white':'bg-[#e9e5da] text-[#77798a]'}`}>{f.publicationStatus}</span>
                </div>
                <div className="mt-1 text-sm">{f.remarks}</div>
                <div className="text-xs text-[#77798a]">Team {f.teamId.slice(0,8)} · {f.reason.slice(0,60)}</div>
                <div className="mt-2 flex gap-2">
                  <button onClick={()=>loadVersions(f.id)} className="rounded-lg border border-[#dedbd1] px-2 py-1 text-xs font-semibold">Versions</button>
                  <button onClick={()=>tryImmutable(f.id)} className="rounded-lg border border-[#dedbd1] px-2 py-1 text-xs font-semibold flex items-center gap-1"><Lock size={12}/> Try PUT 403</button>
                  <button onClick={()=>setCorrectId(f.id)} className="rounded-lg bg-[#f4f1e8] px-2 py-1 text-xs font-bold">Correct</button>
                </div>
                {versions[f.id] && (
                  <div className="mt-2 rounded-xl bg-[#f4f1e8] p-3">
                    <div className="text-xs font-bold">{versions[f.id].length} versions</div>
                    {versions[f.id].map((v:any)=>(
                      <div key={v.id} className="mt-1 flex justify-between rounded-lg bg-white px-2 py-1 text-xs border border-[#e5e1d7]"><span>v{v.version} {v.isCorrection?'(correction)':'(original)'} · {v.score}</span><span className="text-[#77798a]">{new Date(v.createdAt).toLocaleTimeString()}</span></div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
