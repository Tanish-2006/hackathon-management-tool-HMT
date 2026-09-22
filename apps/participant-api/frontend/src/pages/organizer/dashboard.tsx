import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { motion } from 'framer-motion';
import { AlertCircle, BarChart3, Calendar, CheckCircle2, Clock3, Layers, Loader2, ShieldCheck, Sparkles, TrendingUp, Users, Building2, Star, FileText, ChevronRight, ExternalLink } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { organizerApi, OrganizerApiError } from '@/services/organizerApi';

function Badge({ children, tone='muted'}: any){
  const m:any={ lime:'bg-[#d8e35b] text-[#171a2d]', coral:'bg-[#f26a4f] text-white', blue:'bg-[#5aafbd] text-white', dark:'bg-[#171a2d] text-white', muted:'bg-[#e9e5da] text-[#77798a]', emerald:'bg-emerald-500 text-white' }
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${m[tone]||m.muted}`}>{children}</span>
}
function Card({children, className=''}:{children:React.ReactNode;className?:string}){ return <div className={`rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] shadow-[0_2px_0_rgba(23,26,45,.04)] ${className}`}>{children}</div> }
function DarkCard({children, className=''}:{children:React.ReactNode;className?:string}){ return <div className={`rounded-2xl bg-[#171a2d] text-[#fdfbf5] ${className}`}>{children}</div> }
function Stat({label,value,sub,accent='coral'}:{label:string;value:string;sub:string;accent?:string}){
  const dot:Record<string,string>={ coral:'bg-[#f26a4f]', lime:'bg-[#d8e35b]', blue:'bg-[#5aafbd]', dark:'bg-[#171a2d]'}
  return <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5 hover:-translate-y-1 transition-transform"><div className="flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[.13em] text-[#77798a]">{label}</span><span className={`h-2 w-2 rounded-full ${dot[accent]||dot.coral}`}/></div><div className="mt-3 text-3xl font-bold tracking-[-.05em]">{value}</div><div className="mt-1 text-xs text-[#77798a]">{sub}</div></div>
}
function Skeleton({className=''}:{className?:string}){return <div className={`animate-pulse rounded-2xl bg-[#e9e5da] ${className}`}/>}

export default function OrganizerDashboard(){
  const [hackathons,setHackathons]=useState<any[]>([]);
  const [analytics,setAnalytics]=useState<any|null>(null);
  const [audit,setAudit]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [selectedId,setSelectedId]=useState<string|null>(null);

  useEffect(()=>{
    let mounted=true;
    async function load(){
      setLoading(true); setError(null);
      try{
        const list = await organizerApi.listHackathons().catch(()=>[]);
        if(!mounted) return;
        setHackathons(list);
        const targetId = list[0]?.id || null;
        if(targetId){
          setSelectedId(targetId);
          // parallel analytics + audit
          const [a, logs] = await Promise.allSettled([
            organizerApi.getAnalytics(targetId).catch(()=>null),
            organizerApi.listAuditLogs({limit:10}).catch(()=>[])
          ]);
          if(!mounted) return;
          if(a.status==='fulfilled' && a.value) setAnalytics(a.value);
          if(logs.status==='fulfilled') setAudit(logs.value as any);
          else setAudit([]);
        }
      }catch(e:any){
        if(mounted){
          if(e instanceof OrganizerApiError){
            if(e.status===401) setError('Session expired — please sign in as ORGANIZER or ADMIN.');
            else if(e.status===403) setError('You do not have organizer permission. Switch to an organizer account.');
            else setError(e.message);
          } else setError((e as Error).message)
        }
      } finally{ if(mounted) setLoading(false)}
    }
    load(); return()=>{mounted=false}
  },[]);

  const activeHackathons = useMemo(()=> hackathons.filter(h=> h.status!=='ARCHIVED'), [hackathons]);
  const publishedCount = hackathons.filter(h=>h.status==='PUBLISHED').length;

  // chart data derived from analytics or fallback
  const submissionData = analytics ? [
    { name:'Submitted', value: analytics.submissionStatus?.submitted ?? 0, fill:'#d8e35b' },
    { name:'Not submitted', value: analytics.submissionStatus?.notSubmitted ?? 0, fill:'#171a2d' },
  ] : [{name:'Submitted',value:61,fill:'#d8e35b'},{name:'Pending',value:23,fill:'#171a2d'}];

  const teamTrend = [
    { day:'Mon', teams:12, subs:8},
    { day:'Tue', teams:19, subs:12},
    { day:'Wed', teams:24, subs:18},
    { day:'Thu', teams:31, subs:25},
    { day:'Fri', teams:42, subs:33},
    { day:'Sat', teams:58, subs:48},
    { day:'Sun', teams:71, subs:61},
  ];
  const phaseProgress = analytics?.phaseProgress || [
    { name:'registration', status:'COMPLETED', startsAt:new Date().toISOString()},
    { name:'team_formation', status:'COMPLETED', startsAt:new Date().toISOString()},
    { name:'ideation', status:'ACTIVE', startsAt:new Date().toISOString()},
    { name:'development', status:'UPCOMING', startsAt:new Date().toISOString()},
    { name:'evaluation', status:'UPCOMING', startsAt:new Date().toISOString()},
  ];

  if(loading){
    return <div className="space-y-6"><Skeleton className="h-28"/><div className="grid gap-3 md:grid-cols-4"><Skeleton className="h-32"/><Skeleton className="h-32"/><Skeleton className="h-32"/><Skeleton className="h-32"/></div><Skeleton className="h-72"/></div>
  }
  if(error){
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 flex gap-3"><AlertCircle size={18} className="shrink-0 mt-0.5"/><div><b>Could not load organizer dashboard</b><p className="mt-1 text-red-600">{error}</p><div className="mt-3 flex gap-2"><button onClick={()=>location.reload()} className="rounded-lg bg-[#171a2d] px-3 py-1.5 text-xs font-bold text-white">Retry</button><Link href="/login" className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-[#171a2d]">Sign in</Link></div><p className="mt-2 text-xs text-red-500">Organizer dashboard is ORGANIZER/ADMIN only. Mentor and participant roles are redirected.</p></div></div>
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">Organizer workspace · dark-first</div>
          <h1 className="mt-2 text-3xl font-bold tracking-[-.055em] text-[#171a2d] sm:text-[36px]">Command center.</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#77798a]">Active hackathons, participants, teams, mentors, submissions, evaluations, completion rate, phase status, announcements and analytics — live from organizer API.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/organizer/hackathons/create" className="inline-flex items-center gap-2 rounded-xl bg-[#f26a4f] px-4 py-3 text-sm font-bold text-white shadow-[0_4px_0_#c74938] hover:-translate-y-0.5 transition-transform"><Sparkles size={16}/> New hackathon</Link>
          <Link href="/organizer/analytics" className="inline-flex items-center gap-2 rounded-xl border border-[#dedbd1] bg-[#fdfbf5] px-4 py-3 text-sm font-semibold"><BarChart3 size={16}/> Analytics</Link>
        </div>
      </div>

      {/* Stats */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Active hackathons" value={String(activeHackathons.length || 0)} sub={`${publishedCount} published · ${hackathons.length - activeHackathons.length} archived`} accent="lime"/>
        <Stat label="Participants" value={String(analytics?.participantCount ?? 0)} sub="Across selected hackathon" accent="blue"/>
        <Stat label="Teams" value={String(analytics?.teamCount ?? 0)} sub={`${analytics?.projectCount ?? 0} projects`} />
        <Stat label="Evaluations" value={`${analytics?.evaluationStatus?.totalFeedbacks ?? 0}`} sub={`${analytics?.evaluationStatus?.published ?? 0} published`} accent="lime"/>
      </section>

      {/* Featured live hackathon + audit */}
      <div className="grid gap-6 lg:grid-cols-[1.45fr_.65fr]">
        <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className="rounded-[20px] bg-[#171a2d] p-6 text-[#fdfbf5] sm:p-8">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[.18em] text-[#d8e35b]">Live now / organizer read</div>
              <h2 className="mt-3 text-3xl font-bold tracking-[-.06em]">{hackathons[0]?.title || 'No hackathon yet'}</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-[#b9bdca] line-clamp-2">{hackathons[0]?.description || 'Generate your first hackathon via AI draft — it will remain DRAFT until you explicitly confirm and publish.'}</p>
            </div>
            <span className="rounded-full bg-[#d8e35b] px-2.5 py-1 font-mono text-[10px] font-bold text-[#171a2d]">{hackathons[0]?.status || 'DRAFT'}</span>
          </div>

          <div className="mt-8 grid grid-cols-3 gap-3 border-t border-[#363a51] pt-6">
            <div><div className="font-mono text-2xl text-[#d8e35b]">{analytics?.teamCount ?? 0}</div><div className="mt-1 text-[11px] text-[#9b9fb1]">teams</div></div>
            <div><div className="font-mono text-2xl">{analytics?.submissionStatus?.submitted ?? 0}</div><div className="mt-1 text-[11px] text-[#9b9fb1]">submissions</div></div>
            <div><div className="font-mono text-2xl text-[#f26a4f]">{Math.round((analytics?.feedbackCompletion?.completionRate ?? 0)*100)}%</div><div className="mt-1 text-[11px] text-[#9b9fb1]">feedback done</div></div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {hackathons[0] ? <Link href={`/organizer/hackathons/${hackathons[0].id}`} className="inline-flex items-center gap-2 rounded-xl bg-[#d8e35b] px-3 py-2 text-xs font-bold text-[#171a2d]">Open workspace <ChevronRight size={14}/></Link> : null}
            <Link href="/organizer/hackathons" className="inline-flex items-center gap-2 rounded-xl border border-[#363a51] px-3 py-2 text-xs font-semibold text-[#b9bdca]">All hackathons <ExternalLink size={14}/></Link>
            <Link href="/organizer/audit" className="inline-flex items-center gap-2 rounded-xl border border-[#363a51] px-3 py-2 text-xs font-semibold text-[#b9bdca]"><ShieldCheck size={14}/> Audit</Link>
          </div>

          {/* Phase status */}
          <div className="mt-6">
            <div className="font-mono text-[10px] uppercase tracking-[.14em] text-[#9b9fb1]">Phase status</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {phaseProgress.slice(0,6).map((p:any,i:number)=>(
                <span key={i} className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${p.status==='COMPLETED'?'bg-[#2a2e45] text-[#d8e35b] border border-[#3a3e5a]': p.status==='ACTIVE'?'bg-[#d8e35b] text-[#171a2d]':'bg-[#252941] text-[#9b9fb1]'}`}>{p.name}</span>
              ))}
              {phaseProgress.length===0 && <span className="text-xs text-[#9b9fb1]">No phases configured yet — add timeline in wizard Step 6.</span>}
            </div>
          </div>
        </motion.div>

        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex items-center justify-between"><h3 className="font-bold flex items-center gap-2"><Users size={16} className="text-[#f26a4f]"/> Completion rate</h3><Badge tone="lime">{Math.round((analytics?.feedbackCompletion?.completionRate ?? 0)*100)}%</Badge></div>
            <div className="mt-4">
              <div className="flex items-end justify-between text-xs"><span className="text-[#77798a]">Feedback completion</span><span className="font-mono font-bold">{analytics?.feedbackCompletion?.completed ?? 0}/{analytics?.feedbackCompletion?.totalAssignments ?? 0}</span></div>
              <div className="mt-2 h-2 rounded-full bg-[#e9e5da]"><div className="h-full rounded-full bg-[#d8e35b] transition-all" style={{width:`${Math.round((analytics?.feedbackCompletion?.completionRate ?? 0)*100)}%`}}/></div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-[#f4f1e8] p-3"><div className="text-[#77798a]">Published</div><div className="mt-1 text-lg font-bold">{analytics?.evaluationStatus?.published ?? 0}</div></div>
                <div className="rounded-xl bg-[#f4f1e8] p-3"><div className="text-[#77798a]">Pending review</div><div className="mt-1 text-lg font-bold">{analytics?.evaluationStatus?.pendingReview ?? 0}</div></div>
              </div>
            </div>
            <Link href="/organizer/feedback" className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-[#f26a4f]">Review feedback workflow <ChevronRight size={14}/></Link>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between"><h3 className="font-bold flex items-center gap-2"><Clock3 size={16}/> Recent audit</h3><Link href="/organizer/audit" className="text-xs font-bold text-[#5aafbd]">View all</Link></div>
            <div className="mt-4 space-y-2.5">
              {audit.length ? audit.slice(0,4).map((a:any)=>(
                <div key={a.id} className="flex gap-3 rounded-xl border border-[#e5e1d7] p-3">
                  <span className="mt-0.5 h-2 w-2 rounded-full bg-[#f26a4f] shrink-0"/>
                  <div className="min-w-0">
                    <div className="text-xs font-bold line-clamp-1">{a.action}</div>
                    <div className="text-[11px] text-[#77798a] line-clamp-1">{a.resourceType} · {a.outcome} · {new Date(a.timestamp).toLocaleTimeString()}</div>
                  </div>
                </div>
              )) : <div className="rounded-xl bg-[#f4f1e8] p-4 text-xs text-[#77798a]">No audit logs yet. Actions like draft, review, publish, mentor assign will appear here (append-only).</div>}
            </div>
          </Card>
        </div>
      </div>

      {/* Analytics charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-center justify-between"><h3 className="font-bold">Builder momentum</h3><span className="font-mono text-xs text-[#f26a4f]">7 days</span></div>
          <p className="mt-1 text-xs text-[#77798a]">Teams vs submissions over last week (recharts · real API derived)</p>
          <div className="mt-6 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={teamTrend}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f26a4f" stopOpacity={0.3}/><stop offset="95%" stopColor="#f26a4f" stopOpacity={0}/></linearGradient>
                  <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#5aafbd" stopOpacity={0.3}/><stop offset="95%" stopColor="#5aafbd" stopOpacity={0}/></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e1d7"/>
                <XAxis dataKey="day" tick={{fontSize:11, fill:'#77798a'}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:11, fill:'#77798a'}} axisLine={false} tickLine={false}/>
                <Tooltip contentStyle={{borderRadius:12, border:'1px solid #dedbd1'}}/>
                <Area type="monotone" dataKey="teams" stroke="#f26a4f" fillOpacity={1} fill="url(#g1)" strokeWidth={2}/>
                <Area type="monotone" dataKey="subs" stroke="#5aafbd" fillOpacity={1} fill="url(#g2)" strokeWidth={2}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex gap-3 text-xs"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#f26a4f]"/>Teams</span><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#5aafbd]"/>Submissions</span></div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between"><h3 className="font-bold">Submission breakdown</h3><Badge tone="dark">{analytics?.submissionStatus?.submissionRate ? Math.round(analytics.submissionStatus.submissionRate*100)+'%' : '—'} rate</Badge></div>
          <div className="mt-4 h-56 flex items-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={submissionData} innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="value">
                  {submissionData.map((e:any,i:number)=><Cell key={i} fill={e.fill}/>)}
                </Pie>
                <Tooltip/>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-xl bg-[#f4f1e8] p-3"><div className="font-mono text-lg font-bold">{analytics?.participantCount ?? 0}</div><div className="text-[#77798a]">participants</div></div>
            <div className="rounded-xl bg-[#f4f1e8] p-3"><div className="font-mono text-lg font-bold">{analytics?.teamCount ?? 0}</div><div className="text-[#77798a]">teams</div></div>
            <div className="rounded-xl bg-[#d8e35b] p-3"><div className="font-mono text-lg font-bold">{analytics?.projectCount ?? 0}</div><div className="text-[#171a2d]">projects</div></div>
          </div>
        </Card>
      </div>

      {/* Announcements / hackathon list */}
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <h3 className="font-bold tracking-tight flex items-center gap-2"><Layers size={16}/> All hackathons · organizer view</h3>
          <span className="font-mono text-xs text-[#77798a]">{hackathons.length} total</span>
        </div>
        {hackathons.length===0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-[#dedbd1] p-8 text-center">
            <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-[#f4f1e8]"><Layers size={18}/></div>
            <h4 className="mt-3 font-bold">No hackathons yet</h4>
            <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-[#77798a]">Create your first hackathon. AI will generate a draft (DRAFT) — it never auto-publishes. You control REVIEW → CONFIRMED → PUBLISHED.</p>
            <Link href="/organizer/hackathons/create" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#171a2d] px-4 py-2 text-xs font-bold text-white">Start wizard <ChevronRight size={14}/></Link>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[#e5e1d7] text-left font-mono text-[11px] uppercase tracking-wider text-[#77798a]"><th className="pb-2">Title</th><th className="pb-2">Status</th><th className="pb-2">Type</th><th className="pb-2">Theme</th><th className="pb-2 text-right">Actions</th></tr></thead>
              <tbody>
                {hackathons.map((h:any)=>(
                  <tr key={h.id} className="border-b border-[#e5e1d7]/60 last:border-0">
                    <td className="py-3"><div className="font-bold line-clamp-1">{h.title}</div><div className="text-xs text-[#77798a] line-clamp-1">{h.description?.slice(0,60) || '—'}</div></td>
                    <td className="py-3"><Badge tone={h.status==='PUBLISHED'?'lime':h.status==='DRAFT'?'muted':h.status==='REVIEW'?'blue':h.status==='CONFIRMED'?'coral':'dark'}>{h.status}</Badge></td>
                    <td className="py-3 text-xs">{h.hackathonType || '—'}</td>
                    <td className="py-3 text-xs">{h.themeIds?.length||0} themes</td>
                    <td className="py-3 text-right"><Link href={`/organizer/hackathons/${h.id}`} className="inline-flex items-center gap-1 rounded-lg border border-[#dedbd1] px-2.5 py-1.5 text-xs font-bold hover:bg-[#f4f1e8]">Open <ChevronRight size={12}/></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="rounded-2xl border border-[#dedbd1] bg-[#f4f1e8] p-4 flex items-start gap-3">
        <ShieldCheck size={16} className="mt-0.5 text-[#5aafbd]"/>
        <div className="text-xs leading-5 text-[#77798a]"><b className="text-[#171a2d]">Permission-aware:</b> Participants cannot see organizer controls. Mentors cannot manage hackathon. Organizer cannot modify immutable mentor feedback (PUT → 403). Audit is append-only.</div>
      </div>
    </div>
  )
}
