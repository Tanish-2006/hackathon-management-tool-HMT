import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { AlertCircle, ArrowLeft, BarChart3, Layers, Loader2, TrendingUp, Users, ShieldCheck } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Line, LineChart, Area, AreaChart } from 'recharts';
import { organizerApi, OrganizerApiError } from '@/services/organizerApi';

function Card({children,className=''}:{children:React.ReactNode;className?:string}){ return <div className={`rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] ${className}`}>{children}</div> }
function Stat({label,value,sub,accent='coral'}:{label:string;value:string;sub:string;accent?:string}){
  const dot:Record<string,string>={ coral:'bg-[#f26a4f]', lime:'bg-[#d8e35b]', blue:'bg-[#5aafbd]', dark:'bg-[#171a2d]'}
  return <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5"><div className="flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[.13em] text-[#77798a]">{label}</span><span className={`h-2 w-2 rounded-full ${dot[accent]||dot.coral}`}/></div><div className="mt-3 text-2xl font-bold">{value}</div><div className="mt-1 text-xs text-[#77798a]">{sub}</div></div>
}

export default function OrganizerAnalytics(){
  const [hackathons,setHackathons]=useState<any[]>([]);
  const [selected,setSelected]=useState<string>('');
  const [data,setData]=useState<any|null>(null);
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
    organizerApi.getAnalytics(selected).then(setData).catch((e:any)=>{
      if(e instanceof OrganizerApiError && e.status===403) setError('Only the organizer who owns this hackathon can see its analytics.');
      else setError(e.message);
      setData(null);
    }).finally(()=> setLoading(false))
  },[selected]);

  const pieSubmission = useMemo(()=> data ? [
    {name:'Submitted', value: data.submissionStatus.submitted, fill:'#d8e35b'},
    {name:'Not submitted', value: data.submissionStatus.notSubmitted, fill:'#e9e5da'},
  ] : [], [data]);

  const barEvaluation = useMemo(()=> data ? [
    {name:'Published', value: data.evaluationStatus.published},
    {name:'Pending', value: data.evaluationStatus.pendingReview},
    {name:'Unpub', value: data.evaluationStatus.unpublished},
  ] : [],[data]);

  const linePhases = useMemo(()=> data?.phaseProgress?.map((p:any,i:number)=>({ name: p.name.slice(0,8), status: p.status==='COMPLETED'?2 : p.status==='ACTIVE'?1:0, order:p.order })) || [],[data]);

  if(initial) return <div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/organizer/dashboard" aria-label="Back" title="Back" className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] p-2"><ArrowLeft size={16}/></Link>
        <div>
                    <h1 className="text-2xl font-bold">Analytics</h1>
        </div>
      </div>

      <div className="flex gap-3">
        <label className="flex-1 text-sm font-semibold">Hackathon<select value={selected} onChange={e=>setSelected(e.target.value)} className="hmt-input">{hackathons.map(h=> <option key={h.id} value={h.id}>{h.title} — {h.status}</option>)}</select></label>
        <button onClick={()=> selected && organizerApi.getAnalytics(selected).then(setData).catch((e:any)=>setError(e.message))} className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] px-4 py-3 text-xs font-bold self-end">Refresh</button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2"><AlertCircle size={16}/>{error}</div>}
      {loading && <div className="flex items-center gap-2 text-sm text-[#77798a]"><Loader2 size={16} className="animate-spin"/> Loading analytics…</div>}

      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Participants" value={String(data.participantCount)} sub="Total enrolled" accent="blue"/>
            <Stat label="Teams" value={String(data.teamCount)} sub={`${data.projectCount} projects`} accent="lime"/>
            <Stat label="Submission rate" value={`${Math.round(data.submissionStatus.submissionRate*100)}%`} sub={`${data.submissionStatus.submitted}/${data.submissionStatus.totalTeams} teams`}/>
            <Stat label="Feedback completion" value={`${Math.round(data.feedbackCompletion.completionRate*100)}%`} sub={`${data.feedbackCompletion.completed}/${data.feedbackCompletion.totalAssignments} assignments`} accent="lime"/>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-6">
              <h3 className="font-bold">Submission breakdown</h3>
              <p className="mt-1 text-xs text-[#77798a]">Total teams {data.submissionStatus.totalTeams} · Submitted {data.submissionStatus.submitted}</p>
              <div className="mt-4 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieSubmission} innerRadius={60} outerRadius={90} dataKey="value" paddingAngle={3}>
                      {pieSubmission.map((e,i)=><Cell key={i} fill={e.fill}/>)}
                    </Pie>
                    <Tooltip/>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex gap-2 justify-center text-xs"><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#d8e35b]"/>Submitted</span><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#e9e5da]"/>Not submitted</span></div>
            </Card>

            <Card className="p-6">
              <h3 className="font-bold">Evaluation status</h3>
              <p className="mt-1 text-xs text-[#77798a]">Published {data.evaluationStatus.published} · Pending {data.evaluationStatus.pendingReview} · Unpublished {data.evaluationStatus.unpublished}</p>
              <div className="mt-4 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barEvaluation}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e1d7"/>
                    <XAxis dataKey="name" tick={{fontSize:11, fill:'#77798a'}} axisLine={false} tickLine={false}/>
                    <YAxis tick={{fontSize:11, fill:'#77798a'}} axisLine={false} tickLine={false}/>
                    <Tooltip/>
                    <Bar dataKey="value" fill="#f26a4f" radius={[8,8,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.4fr_.6fr]">
            <Card className="p-6">
              <h3 className="font-bold flex items-center gap-2"><TrendingUp size={16}/> Phase progress</h3>
              <p className="mt-1 text-xs text-[#77798a]">{data.phaseProgress.length} phases · statuses derived from timeline</p>
              <div className="mt-4 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={linePhases}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e1d7"/>
                    <XAxis dataKey="name" tick={{fontSize:10, fill:'#77798a'}} axisLine={false} tickLine={false}/>
                    <YAxis domain={[0,2]} tick={{fontSize:10, fill:'#77798a'}} tickFormatter={(v)=> v===2?'Done':v===1?'Active':'Todo'} axisLine={false} tickLine={false}/>
                    <Tooltip/>
                    <Area type="monotone" dataKey="status" stroke="#5aafbd" fill="#5aafbd" fillOpacity={0.2} strokeWidth={2}/>
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {data.phaseProgress.map((p:any)=>(
                  <div key={p.phaseId} className="flex justify-between rounded-xl border border-[#e5e1d7] bg-white px-3 py-2 text-xs">
                    <span><b>{p.name}</b></span><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${p.status==='COMPLETED'?'bg-[#d8e35b] text-[#171a2d]':p.status==='ACTIVE'?'bg-[#5aafbd] text-white':'bg-[#e9e5da] text-[#77798a]'}`}>{p.status}</span>
                  </div>
                ))}
              </div>
            </Card>

            <div className="space-y-6">
              <Card className="p-6">
                <h3 className="font-bold">Feedback completion</h3>
                <div className="mt-3">
                  <div className="flex justify-between text-xs"><span className="text-[#77798a]">Completed / Assignments</span><span className="font-mono font-bold">{data.feedbackCompletion.completed}/{data.feedbackCompletion.totalAssignments}</span></div>
                  <div className="mt-2 h-2 rounded-full bg-[#e9e5da]"><div className="h-full rounded-full bg-[#f26a4f]" style={{width:`${Math.round(data.feedbackCompletion.completionRate*100)}%`}}/></div>
                  <div className="mt-2 text-xs text-[#77798a]">Rate {Math.round(data.feedbackCompletion.completionRate*100)}% — assignments vs feedbacks</div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl bg-[#f4f1e8] p-3"><div className="text-[#77798a]">Teams</div><div className="text-lg font-bold">{data.teamCount}</div></div>
                  <div className="rounded-xl bg-[#f4f1e8] p-3"><div className="text-[#77798a]">Feedbacks</div><div className="text-lg font-bold">{data.evaluationStatus.totalFeedbacks}</div></div>
                </div>
              </Card>

              <Card className="p-6">
                <h3 className="font-bold">At a glance</h3>
                <div className="mt-3 space-y-2 text-xs">
                  <div className="flex justify-between border-b border-[#e5e1d7] py-2"><span className="text-[#77798a]">Participants</span><b>{data.participantCount}</b></div>
                  <div className="flex justify-between border-b border-[#e5e1d7] py-2"><span className="text-[#77798a]">Teams</span><b>{data.teamCount}</b></div>
                  <div className="flex justify-between border-b border-[#e5e1d7] py-2"><span className="text-[#77798a]">Projects</span><b>{data.projectCount}</b></div>
                  <div className="flex justify-between py-2"><span className="text-[#77798a]">Generated at</span><b className="font-mono text-[11px]">{new Date(data.generatedAt).toLocaleString()}</b></div>
                </div>
                <Link href="/organizer/audit" className="mt-3 inline-flex text-xs font-bold text-[#5aafbd]">Audit trail →</Link>
              </Card>
            </div>
          </div>
        </>
      ) : !loading && !error ? <div className="rounded-2xl border border-dashed border-[#dedbd1] bg-[#fdfbf5] p-8 text-center text-sm text-[#77798a]">Select a hackathon to see its analytics.</div> : null}
    </div>
  )
}
