import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Trophy, MessageSquare, AlertTriangle, Target, TrendingUp, Calendar, Award, Eye, Loader2, AlertCircle, X, Check, BarChart3, Lightbulb, FileX2, Star } from 'lucide-react';
import { hmtBackendService, ApiError } from '@/services/backendApi';
import { useHackathonContext } from '@/hooks/use-hackathon-context';
import { Link } from 'wouter';

function friendly(e:unknown){ return e instanceof ApiError? e.message : (e as Error)?.message || 'Failed' }

function Badge({children,tone='muted'}:any){
  const m:any={ lime:'bg-[#d8e35b] text-[#171a2d]', coral:'bg-[#f26a4f] text-white', blue:'bg-[#5aafbd] text-white', dark:'bg-[#171a2d] text-white', muted:'bg-[#e9e5da] text-[#77798a]' };
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${m[tone]||m.muted}`}>{children}</span>
}

export default function ParticipantPerformance(){
  const [timeline,setTimeline]=useState<any>(null);
  const [feedback,setFeedback]=useState<any[]>([]);
  const [evals,setEvals]=useState<any[]>([]);
  const [mistakes,setMistakes]=useState<any[]>([]);
  const [phase,setPhase]=useState<any[]>([]);
  const [improvements,setImprovements]=useState<any[]>([]);
  const [history,setHistory]=useState<any>(null);
  const [elim,setElim]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [activeTab,setActiveTab]=useState<'timeline'|'feedback'|'evaluations'|'mistakes'>('timeline');

  const ctx = useHackathonContext();
  const contextId = ctx.selectedId;

  useEffect(()=>{
    if(ctx.loading) { setLoading(true); return; }
    let m=true;
    async function load(){
      setLoading(true); setError(null);
      try{
        let projectId: string | undefined;
        if(contextId){
          try{
            const p = await hmtBackendService.getMyProject(contextId);
            const proj = (p as any)?.project ?? p;
            if(proj?.id) projectId = proj.id;
          }catch {}
        }
        const [tl, fb, ev, mi, ph, imp, hi, el] = await Promise.allSettled([
          hmtBackendService.getTimeline(projectId),
          hmtBackendService.getPerformanceFeedback(projectId),
          hmtBackendService.getPerformanceEvaluations(projectId),
          hmtBackendService.getPerformanceMistakes(projectId),
          hmtBackendService.getPerformancePhaseProgress(projectId),
          hmtBackendService.getImprovementAreas(projectId),
          hmtBackendService.getPerformanceHistory(projectId),
          hmtBackendService.getEliminationAnalysis(projectId),
        ]);
        if(!m) return;
        if(tl.status==='fulfilled') setTimeline(tl.value as any);
        if(fb.status==='fulfilled'){ const v:any=fb.value; setFeedback(v?.feedbacks || v?.data || []); }
        if(ev.status==='fulfilled'){ const v:any=ev.value; setEvals(v?.evaluations || v?.data || []); }
        if(mi.status==='fulfilled'){ const v:any=mi.value; setMistakes(v?.mistakes || v?.data || []); }
        if(ph.status==='fulfilled'){ const v:any=ph.value; setPhase(v?.phaseProgress || v?.data || []); }
        if(imp.status==='fulfilled'){ const v:any=imp.value; setImprovements(v?.improvementAreas || v?.data || []); }
        if(hi.status==='fulfilled') setHistory(hi.value as any);
        if(el.status==='fulfilled') setElim(el.value as any);
        if(tl.status==='fulfilled'){
          const t:any=tl.value;
          if(t?.feedbacks && !feedback.length) setFeedback(t.feedbacks);
          if(t?.evaluations && !evals.length) setEvals(t.evaluations);
          if(t?.mistakes && !mistakes.length) setMistakes(t.mistakes);
          if(t?.phaseProgress && !phase.length) setPhase(t.phaseProgress);
        }
      }catch(e){ if(m) setError(friendly(e)); }
      finally{ if(m) setLoading(false); }
    }
    load(); return ()=>{m=false}
  },[ctx.loading, contextId]);

  if(loading) return <div className="space-y-4"><div className="h-24 animate-pulse rounded-2xl bg-[#e9e5da]"/><div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/></div>
  if(error) return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 flex gap-2"><AlertCircle size={16}/>{error}<button onClick={()=>setError(null)} className="ml-auto"><X size={14}/></button></div>

  const avgScore = evals.length ? (evals.reduce((s:number,e:any)=> s+ (e.score||0),0)/evals.length).toFixed(1) : '—';
  const hasHistory = !!history && !history.message;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">Progress</div>
          <h1 className="mt-2 text-3xl font-bold tracking-[-.05em] text-[#171a2d]">Your learning, measured.</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#77798a]">Feedback, scores and what to improve, once organizers publish them.</p>
        </div>
        <div className="flex gap-2">
          <span className="rounded-full bg-[#171a2d] px-3 py-1.5 text-xs font-bold text-white flex items-center gap-1"><Trophy size={14}/> Avg {avgScore}</span>
          <span className="rounded-full bg-[#d8e35b] px-3 py-1.5 text-xs font-bold text-[#171a2d]">{evals.length} evaluations</span>
        </div>
      </div>

      <div className="rounded-xl border border-[#dedbd1] bg-[#f4f1e8] px-4 py-2.5 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        {ctx.loading ? (
          <span className="text-xs text-[#77798a]">Loading hackathon context…</span>
        ) : !contextId ? (
          <span className="text-xs text-[#55586a]">No hackathon context — <Link href="/participant/hackathons" className="font-bold underline">register in Discover</Link> to track progress.</span>
        ) : (
          <>
            <label className="flex items-center gap-2 text-xs font-semibold text-[#55586a]">Hackathon
              <select
                value={contextId}
                onChange={e=>ctx.select(e.target.value || null)}
                className="rounded-lg border border-[#dedbd1] bg-white px-2 py-1.5 text-xs font-bold text-[#171a2d] outline-none"
                aria-label="Select hackathon context"
              >
                {ctx.options.map(o=><option key={o.id} value={o.id}>{o.title}{o.registered?'':' (not registered)'}</option>)}
              </select>
            </label>
            <span className="text-[11px] text-[#77798a]">Showing results for this hackathon.</span>
          </>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5"><div className="font-mono text-[10px] uppercase tracking-wider text-[#77798a]">Mentor feedback</div><div className="mt-2 text-2xl font-bold">{feedback.length}</div><div className="text-xs text-[#77798a]">Published only</div></div>
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5"><div className="font-mono text-[10px] uppercase tracking-wider text-[#77798a]">Phase progress</div><div className="mt-2 text-2xl font-bold">{phase.length}</div><div className="text-xs text-[#77798a]">Milestone updates</div></div>
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5"><div className="font-mono text-[10px] uppercase tracking-wider text-[#77798a]">Mistakes tracked</div><div className="mt-2 text-2xl font-bold">{mistakes.length}</div><div className="text-xs text-[#77798a]">Learning insights</div></div>
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5"><div className="font-mono text-[10px] uppercase tracking-wider text-[#77798a]">Scans</div><div className="mt-2 text-2xl font-bold">{timeline?.scans?.length ?? 0}</div><div className="text-xs text-[#77798a]">Repository scans</div></div>
      </div>

      <div className="flex gap-2 overflow-auto pb-1">
        {[
          { id:'timeline', label:'Timeline' },
          { id:'feedback', label:'Mentor feedback' },
          { id:'evaluations', label:'Evaluations' },
          { id:'mistakes', label:'Mistakes & improvements' },
        ].map(t=>(
          <button key={t.id} onClick={()=>setActiveTab(t.id as any)} className={`shrink-0 rounded-xl px-4 py-2 text-xs font-bold border ${activeTab===t.id ? 'bg-[#171a2d] text-white border-[#171a2d]' : 'bg-white border-[#dedbd1] text-[#171a2d] hover:bg-[#f4f1e8]'}`}>{t.label}</button>
        ))}
      </div>

      {activeTab==='timeline' && (
        <div className="grid gap-6 lg:grid-cols-[1.35fr_.65fr]">
          <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
            <h3 className="font-bold flex items-center gap-2"><Calendar size={16}/> Timeline</h3>
            <div className="mt-4 space-y-3">
              {(timeline?.phaseProgress || phase).length ? (timeline?.phaseProgress || phase).map((p:any,i:number)=>(
                <div key={p.id||i} className="flex gap-3">
                  <div className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${p.status==='COMPLETED'?'bg-[#d8e35b]': p.status==='ACTIVE'?'bg-[#f26a4f]':'bg-[#5aafbd]'}`}/>
                  <div className="flex-1 rounded-xl bg-[#f4f1e8] p-3">
                    <div className="flex justify-between text-xs"><span className="font-bold">{p.phaseName || p.name}</span><span className="font-mono text-[11px]">{p.status}</span></div>
                    {p.score && <div className="text-xs text-[#77798a]">Score {p.score}</div>}
                  </div>
                </div>
              )) : <div className="rounded-xl bg-[#f4f1e8] p-4 text-xs text-[#77798a]">No progress updates yet.</div>}
              {(timeline?.scans||[]).slice(0,3).map((s:any)=><div key={s.id} className="flex gap-3"><div className="mt-1 h-2.5 w-2.5 rounded-full bg-[#5aafbd] shrink-0"/><div className="flex-1 rounded-xl border border-[#e5e1d7] p-3 text-xs"><div className="font-bold">Scan {s.status || 'COMPLETED'}</div><div className="text-[#77798a]">{s.findings?.length||0} findings · {s.createdAt ? new Date(s.createdAt).toLocaleString():''}</div></div></div>)}
            </div>
          </div>
          <div className="space-y-6">
            <div className="rounded-2xl bg-[#171a2d] p-6 text-[#fdfbf5]">
              <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">Participant history</div>
              <div className="mt-3 space-y-2 text-xs">
                {hasHistory ? (
                  <>
                    <div className="rounded-xl bg-[#252941] p-3"><div className="font-bold">Scores</div><div className="text-[#b9bdca]">{(history.scores||[]).join(', ') || evals.map(e=>e.score).join(', ') || '—'}</div></div>
                    <div className="rounded-xl bg-[#252941] p-3"><div className="font-bold">Lessons learned</div><div className="text-[#b9bdca] line-clamp-3">{history.lessonsLearned?.[0]?.insight || history.lessonsLearned?.[0]?.lessonsLearned || '—'}</div></div>
                    <div className="rounded-xl bg-[#252941] p-3"><div className="font-bold">Elimination</div><div className="text-[#b9bdca]">{elim?.status || history.eliminationReason?.reason || 'Not eliminated'}</div></div>
                  </>
                ) : <div className="rounded-xl bg-[#252941] p-3 text-[#9b9fb1]">{history?.message || 'No history yet — build your project to generate history.'}</div>}
              </div>
              {improvements.length>0 && <div className="mt-3 rounded-xl border border-[#2c3047] p-3 text-xs"><div className="font-bold text-[#d8e35b]">Top improvement</div><div className="text-[#b9bdca]">{improvements[0].area} — {improvements[0].suggestion}</div></div>}
            </div>
            <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
              <h3 className="font-bold flex items-center gap-2"><Lightbulb size={16} className="text-[#f26a4f]"/> Learning insights</h3>
              <div className="mt-3 space-y-2">
                {improvements.length ? improvements.slice(0,3).map((imp:any)=><div key={imp.id} className="rounded-xl bg-[#f4f1e8] p-3 text-xs"><div className="font-bold">{imp.area}</div><div className="text-[#77798a]">{imp.suggestion}</div><div className="mt-1 inline-flex rounded-full bg-white border border-[#dedbd1] px-2 py-1 text-[10px] font-bold">{imp.priority}</div></div>) : <div className="rounded-xl bg-[#f4f1e8] p-3 text-xs text-[#77798a]">No improvement areas published yet.</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab==='feedback' && (
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
          <h3 className="font-bold flex items-center gap-2"><MessageSquare size={16}/> Mentor feedback</h3>
          <p className="mt-1 text-xs text-[#77798a]">Feedback appears here once the organizer publishes it.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {feedback.length ? feedback.map((f:any)=>(
              <div key={f.id} className="rounded-2xl border border-[#e5e1d7] p-4 bg-white">
                <div className="flex items-center justify-between"><span className="text-xs font-bold">{f.author || 'Mentor'}</span><span className="rounded-full bg-[#f4f1e8] px-2 py-1 text-[10px] font-bold uppercase">{f.role || ''} · v{f.version || 1}</span></div>
                <div className="mt-2 text-xs font-semibold text-[#f26a4f]">{f.phase || ''}</div>
                <p className="mt-2 text-sm leading-6 text-[#171a2d]">{f.feedback}</p>
                {f.rating && <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#d8e35b] px-2 py-1 text-xs font-bold"><Star size={12}/> {f.rating}/5</div>}
                <div className="mt-3 flex gap-3 font-mono text-[11px] text-[#77798a]"><span>{f.createdAt ? new Date(f.createdAt).toLocaleString():''}</span><span>Published {f.publishedAt ? new Date(f.publishedAt).toLocaleString(): '—'}</span></div>
              </div>
            )) : <div className="rounded-xl bg-[#f4f1e8] p-6 text-center md:col-span-2 text-xs text-[#77798a]">No published feedback yet.</div>}
          </div>
        </div>
      )}

      {activeTab==='evaluations' && (
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
          <h3 className="font-bold flex items-center gap-2"><Award size={16}/> Evaluations</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {evals.length ? evals.map((e:any)=>(
              <div key={e.id} className="rounded-2xl bg-[#171a2d] p-5 text-[#fdfbf5]">
                <div className="flex items-center justify-between"><span className="font-mono text-[11px] text-[#d8e35b]">{e.role || 'Evaluator'}</span><span className="text-2xl font-bold">{e.score}</span></div>
                <div className="mt-2 text-sm font-bold">{e.evaluator || 'Judge'}</div>
                <div className="mt-2 text-xs leading-5 text-[#b9bdca]">{e.comments || e.feedback || '—'}</div>
                <div className="mt-3 flex flex-wrap gap-1">{(e.criteria||[]).slice(0,3).map((c:any,i:number)=><span key={i} className="rounded-full bg-[#252941] px-2 py-1 text-[10px]">{c.name||c.criteria}: {c.score||''}</span>)}</div>
                <div className="mt-3 font-mono text-[11px] text-[#9b9fb1]">Published {e.publishedAt ? new Date(e.publishedAt).toLocaleDateString():''} · v{e.version||1}</div>
              </div>
            )) : <div className="rounded-xl bg-[#f4f1e8] p-6 text-center md:col-span-3 text-xs text-[#77798a]">No published evaluations yet.</div>}
          </div>
          {evals.length>0 && (
            <div className="mt-6 rounded-xl bg-[#f4f1e8] p-4">
              <div className="text-xs font-bold flex items-center gap-2"><BarChart3 size={14}/> Score breakdown</div>
              <div className="mt-3 h-24 flex items-end gap-2">{evals.map((e:any,i:number)=><div key={i} className="flex-1 rounded-t-lg bg-[#f26a4f]" style={{ height: `${Math.max(12, (e.score/100)*96)}px`}} title={`${e.score}`}/>)}</div>
              <div className="mt-2 flex justify-between font-mono text-[10px] text-[#77798a]">{evals.map((_:any,i:number)=><span key={i}>E{i+1}</span>)}</div>
            </div>
          )}
        </div>
      )}

      {activeTab==='mistakes' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
            <h3 className="font-bold flex items-center gap-2"><AlertTriangle size={16} className="text-[#f26a4f]"/> Mistakes · Published</h3>
            <div className="mt-4 space-y-3">
              {mistakes.length ? mistakes.map((m:any)=><div key={m.id} className="rounded-xl border border-[#e5e1d7] p-4"><div className="flex items-center justify-between"><span className="text-sm font-bold">{m.title}</span><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${m.severity==='HIGH'?'bg-red-100 text-red-700': m.severity==='MEDIUM'?'bg-amber-100 text-amber-700':'bg-[#f4f1e8] text-[#77798a]'}`}>{m.severity}</span></div><p className="mt-2 text-xs leading-5 text-[#77798a]">{m.description}</p><div className="mt-2 inline-flex rounded-full bg-[#171a2d] px-2 py-1 text-[11px] font-bold text-white">{m.category}</div></div>) : <div className="rounded-xl bg-[#f4f1e8] p-4 text-xs text-[#77798a]">Nothing flagged.</div>}
            </div>
          </div>
          <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
            <h3 className="font-bold flex items-center gap-2"><Target size={16}/> Improvement areas</h3>
            <div className="mt-4 space-y-3">
              {improvements.length ? improvements.map((imp:any)=><div key={imp.id} className="rounded-xl bg-[#f4f1e8] p-3 text-xs"><div className="font-bold">{imp.area}</div><div className="text-[#77798a]">{imp.suggestion}</div><div className="mt-1 text-[11px] font-mono">{imp.priority}</div></div>) : <div className="rounded-xl bg-[#f4f1e8] p-3 text-xs text-[#77798a]">No improvement areas.</div>}
              <div className="rounded-xl bg-[#171a2d] p-4 text-[#fdfbf5] text-xs">
                <div className="font-bold text-[#d8e35b] flex items-center gap-2"><FileX2 size={14}/> Elimination analysis</div>
                {elim?.status==='ELIMINATED' ? <><p className="mt-2 text-[#b9bdca]">{elim.record?.reason}</p><div className="mt-2 rounded-lg bg-[#252941] p-2"><div className="font-bold">What went wrong</div><div className="text-[#9b9fb1]">{elim.aiPostMortem?.whatWentWrong}</div></div><div className="mt-1 rounded-lg bg-[#252941] p-2"><div className="font-bold">Corrective action</div><div className="text-[#9b9fb1]">{elim.aiPostMortem?.correctiveAction}</div></div></> : <p className="mt-2 text-[#9b9fb1]">{elim?.message || elim?.status || 'Team is active in competition.'}</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
