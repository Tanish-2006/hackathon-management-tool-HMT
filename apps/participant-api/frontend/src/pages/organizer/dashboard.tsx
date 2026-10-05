import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { motion } from 'framer-motion';
import { AlertCircle, BarChart3, Calendar, CheckCircle2, Clock3, Layers, ShieldCheck, Sparkles, Users, ChevronRight, ExternalLink } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { organizerApi, OrganizerApiError } from '@/services/organizerApi';

function Badge({ children, tone='muted'}: any){
  const m:any={ lime:'bg-[#d8e35b] text-[#171a2d]', coral:'bg-[#f26a4f] text-white', blue:'bg-[#5aafbd] text-white', dark:'bg-[#171a2d] text-white', muted:'bg-[#e9e5da] text-[#77798a]', emerald:'bg-emerald-500 text-white' }
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${m[tone]||m.muted}`}>{children}</span>
}
function Card({children, className=''}:{children:React.ReactNode;className?:string}){ return <div className={`rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] shadow-[0_2px_0_rgba(23,26,45,.04)] ${className}`}>{children}</div> }
function Stat({label,value,sub,accent='coral'}:{label:string;value:string;sub:string;accent?:string}){
  const dot:Record<string,string>={ coral:'bg-[#f26a4f]', lime:'bg-[#d8e35b]', blue:'bg-[#5aafbd]', dark:'bg-[#171a2d]'}
  return <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5 hover:-translate-y-1 transition-transform"><div className="flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-[.13em] text-[#77798a]">{label}</span><span className={`h-2 w-2 rounded-full ${dot[accent]||dot.coral}`}/></div><div className="mt-3 text-3xl font-bold tracking-[-.05em]">{value}</div><div className="mt-1 text-xs text-[#77798a]">{sub}</div></div>
}
function Skeleton({className=''}:{className:string}){return <div className={`animate-pulse rounded-2xl bg-[#e9e5da] ${className}`}/>}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function OrganizerDashboard(){
  const [overview,setOverview]=useState<any|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);

  useEffect(()=>{
    let mounted=true;
    async function load(){
      setLoading(true); setError(null);
      try{
        const data = await organizerApi.getOverview();
        if(!mounted) return;
        setOverview(data);
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

  if(loading){
    return <div className="space-y-6"><Skeleton className="h-28"/><div className="grid gap-3 md:grid-cols-4"><Skeleton className="h-32"/><Skeleton className="h-32"/><Skeleton className="h-32"/><Skeleton className="h-32"/></div><Skeleton className="h-72"/></div>
  }
  if(error){
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 flex gap-3"><AlertCircle size={18} className="shrink-0 mt-0.5"/><div><b>Could not load organizer dashboard</b><p className="mt-1 text-red-600">{error}</p><div className="mt-3 flex gap-2"><button onClick={()=>location.reload()} className="rounded-lg bg-[#171a2d] px-3 py-1.5 text-xs font-bold text-white">Retry</button><Link href="/login" className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-[#171a2d]">Sign in</Link></div><p className="mt-2 text-xs text-red-500">Organizer dashboard is ORGANIZER/ADMIN only. Mentor and participant roles are redirected.</p></div></div>
  }

  const summary = overview?.summary ?? { totalHackathons:0, activeHackathons:0, totalParticipants:0, totalTeams:0, projectsSubmitted:0, pendingEvaluations:0 };
  const active = overview?.activeHackathon ?? null;
  const hackathons: any[] = overview?.hackathons ?? [];
  const registration = overview?.registration ?? null;
  const teamStats = overview?.teams ?? null;
  const submissions = overview?.submissions ?? null;
  const evaluation = overview?.evaluation ?? { total:0, published:0, pendingReview:0 };
  const feedback = overview?.feedback ?? { completed:0, totalAssignments:0, rate:0 };
  const attention: any[] = overview?.attention ?? [];
  const deadlines: any[] = overview?.deadlines ?? [];
  const activity: any[] = overview?.recentActivity ?? [];
  const publishedCount = hackathons.filter((h:any)=>h.status==='PUBLISHED').length;

  const submissionData = submissions ? [
    { name:'Submitted', value: submissions.submitted ?? 0, fill:'#d8e35b' },
    { name:'Not submitted', value: submissions.notSubmitted ?? 0, fill:'#171a2d' },
  ] : [];
  const submissionTotal = submissionData.reduce((n,e)=>n+e.value,0);

  const teamTrend = (overview?.trend ?? []).map((d:any)=>({
    day: new Date(d.day).toLocaleDateString(undefined,{weekday:'short'}),
    teams: d.teams ?? 0,
    subs: d.subs ?? 0,
  }));
  const phaseProgress: any[] = active?.phases ?? [];

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
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Stat label="Total hackathons" value={String(summary.totalHackathons)} sub={`${summary.activeHackathons} active · ${publishedCount} published`} accent="dark"/>
        <Stat label="Active hackathons" value={String(summary.activeHackathons)} sub={active ? `${active.title}` : 'No active hackathon'} accent="lime"/>
        <Stat label="Participants" value={String(summary.totalParticipants)} sub="Across your hackathons" accent="blue"/>
        <Stat label="Teams" value={String(summary.totalTeams)} sub="Across your hackathons" />
        <Stat label="Projects submitted" value={String(summary.projectsSubmitted)} sub="Across your hackathons" accent="lime"/>
        <Stat label="Pending evaluations" value={String(summary.pendingEvaluations)} sub="Awaiting organizer review" accent="coral"/>
      </section>

      {/* Featured live hackathon + completion/activity */}
      <div className="grid gap-6 lg:grid-cols-[1.45fr_.65fr]">
        <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className="rounded-[20px] bg-[#171a2d] p-6 text-[#fdfbf5] sm:p-8">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[.18em] text-[#d8e35b]">Live now / organizer read</div>
              <h2 className="mt-3 text-3xl font-bold tracking-[-.06em] text-white">{active?.title || 'No active hackathon'}</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-[#b9bdca] line-clamp-2">{active?.description || 'Generate your first hackathon via AI draft — it will remain DRAFT until you explicitly confirm and publish.'}</p>
            </div>
            <span className="rounded-full bg-[#d8e35b] px-2.5 py-1 font-mono text-[10px] font-bold text-[#171a2d]">{active?.status || '—'}</span>
          </div>

          {active ? (
          <div className="mt-8 grid grid-cols-2 gap-3 border-t border-[#363a51] pt-6 sm:grid-cols-4">
            <div><div className="font-mono text-2xl text-[#d8e35b]">{active.participantCount ?? 0}</div><div className="mt-1 text-[11px] text-[#9b9fb1]">participants</div></div>
            <div><div className="font-mono text-2xl text-[#fdfbf5]">{active.teamCount ?? 0}</div><div className="mt-1 text-[11px] text-[#9b9fb1]">teams</div></div>
            <div><div className="font-mono text-2xl text-[#fdfbf5]">{active.projectCount ?? 0}</div><div className="mt-1 text-[11px] text-[#9b9fb1]">projects</div></div>
            <div><div className="font-mono text-2xl text-[#f26a4f]">{active.mentorCount ?? 0}</div><div className="mt-1 text-[11px] text-[#9b9fb1]">mentors</div></div>
          </div>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-2">
            {active ? <Link href={`/organizer/hackathons/${active.id}`} className="inline-flex items-center gap-2 rounded-xl bg-[#d8e35b] px-3 py-2 text-xs font-bold text-[#171a2d]">Open workspace <ChevronRight size={14}/></Link> : null}
            {active ? <Link href="/organizer/participants" className="inline-flex items-center gap-2 rounded-xl border border-[#363a51] px-3 py-2 text-xs font-semibold text-[#b9bdca]">Manage participants</Link> : null}
            {active ? <Link href="/organizer/teams" className="inline-flex items-center gap-2 rounded-xl border border-[#363a51] px-3 py-2 text-xs font-semibold text-[#b9bdca]">Manage teams</Link> : null}
            {active ? <Link href="/organizer/evaluations" className="inline-flex items-center gap-2 rounded-xl border border-[#363a51] px-3 py-2 text-xs font-semibold text-[#b9bdca]">Open evaluations</Link> : null}
            <Link href="/organizer/hackathons" className="inline-flex items-center gap-2 rounded-xl border border-[#363a51] px-3 py-2 text-xs font-semibold text-[#b9bdca]">All hackathons <ExternalLink size={14}/></Link>
            <Link href="/organizer/audit" className="inline-flex items-center gap-2 rounded-xl border border-[#363a51] px-3 py-2 text-xs font-semibold text-[#b9bdca]"><ShieldCheck size={14}/> Audit</Link>
          </div>

          {/* Phase status */}
          <div className="mt-6">
            <div className="font-mono text-[10px] uppercase tracking-[.14em] text-[#9b9fb1]">Phase status{active?.currentPhase ? ` · current: ${active.currentPhase}` : ''}</div>
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
            <div className="flex items-center justify-between"><h3 className="font-bold flex items-center gap-2"><Users size={16} className="text-[#f26a4f]"/> Completion rate</h3><Badge tone="lime">{Math.round((feedback.rate ?? 0)*100)}%</Badge></div>
            <div className="mt-4">
              <div className="flex items-end justify-between text-xs"><span className="text-[#77798a]">Feedback completion</span><span className="font-mono font-bold">{feedback.completed ?? 0}/{feedback.totalAssignments ?? 0}</span></div>
              <div className="mt-2 h-2 rounded-full bg-[#e9e5da]"><div className="h-full rounded-full bg-[#d8e35b] transition-all" style={{width:`${Math.round((feedback.rate ?? 0)*100)}%`}}/></div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-[#f4f1e8] p-3"><div className="text-[#77798a]">Published</div><div className="mt-1 text-lg font-bold">{evaluation.published ?? 0}</div></div>
                <div className="rounded-xl bg-[#f4f1e8] p-3"><div className="text-[#77798a]">Pending review</div><div className="mt-1 text-lg font-bold">{evaluation.pendingReview ?? 0}</div></div>
              </div>
            </div>
            <Link href="/organizer/feedback" className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-[#f26a4f]">Review feedback workflow <ChevronRight size={14}/></Link>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between"><h3 className="font-bold flex items-center gap-2"><Clock3 size={16}/> Recent activity</h3><Link href="/organizer/audit" className="text-xs font-bold text-[#5aafbd]">View all</Link></div>
            <div className="mt-4 space-y-2.5">
              {activity.length ? activity.slice(0,4).map((a:any,i:number)=>(
                <div key={i} className="flex gap-3 rounded-xl border border-[#e5e1d7] p-3">
                  <span className="mt-0.5 h-2 w-2 rounded-full bg-[#f26a4f] shrink-0"/>
                  <div className="min-w-0">
                    <div className="text-xs font-bold line-clamp-1">{a.message}</div>
                    <div className="text-[11px] text-[#77798a] line-clamp-1">{relativeTime(a.at)}</div>
                  </div>
                </div>
              )) : <div className="rounded-xl bg-[#f4f1e8] p-4 text-xs text-[#77798a]">No recent activity.</div>}
            </div>
          </Card>
        </div>
      </div>

      {/* Registration + team status */}
      {active ? (
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-center justify-between"><h3 className="font-bold flex items-center gap-2"><CheckCircle2 size={16} className="text-[#5aafbd]"/> Registration overview</h3><Badge tone="blue">{registration?.total ?? 0} registered</Badge></div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-xl bg-[#f4f1e8] p-3"><div className="font-mono text-lg font-bold">{registration?.today ?? 0}</div><div className="text-[#77798a]">today</div></div>
            <div className="rounded-xl bg-[#f4f1e8] p-3"><div className="font-mono text-lg font-bold">{registration?.thisWeek ?? 0}</div><div className="text-[#77798a]">this week</div></div>
            <div className="rounded-xl bg-[#f4f1e8] p-3"><div className="font-mono text-lg font-bold">{registration?.deadline ? formatDate(registration.deadline) : '—'}</div><div className="text-[#77798a]">closes</div></div>
          </div>
          <Link href="/organizer/participants" className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-[#f26a4f]">Manage participants <ChevronRight size={14}/></Link>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between"><h3 className="font-bold flex items-center gap-2"><Users size={16} className="text-[#f26a4f]"/> Team status</h3><Badge tone="dark">{teamStats?.total ?? 0} teams</Badge></div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs">
            <div className="rounded-xl bg-[#f4f1e8] p-3"><div className="font-mono text-lg font-bold">{teamStats?.complete ?? '—'}</div><div className="text-[#77798a]">complete</div></div>
            <div className="rounded-xl bg-[#f4f1e8] p-3"><div className="font-mono text-lg font-bold">{teamStats?.incomplete ?? '—'}</div><div className="text-[#77798a]">incomplete</div></div>
            <div className="rounded-xl bg-[#f4f1e8] p-3"><div className="font-mono text-lg font-bold">{teamStats?.participantsWithoutTeam ?? 0}</div><div className="text-[#77798a]">without team</div></div>
            <div className="rounded-xl bg-[#f4f1e8] p-3"><div className="font-mono text-lg font-bold">{teamStats?.teamsWithoutSubmission ?? 0}</div><div className="text-[#77798a]">no submission</div></div>
          </div>
          <Link href="/organizer/teams" className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-[#f26a4f]">Manage teams <ChevronRight size={14}/></Link>
        </Card>
      </div>
      ) : null}

      {/* Needs attention + deadlines */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-center justify-between"><h3 className="font-bold flex items-center gap-2"><AlertCircle size={16} className="text-[#f26a4f]"/> Needs attention</h3><Badge tone={attention.length ? 'coral' : 'lime'}>{attention.length ? `${attention.length} open` : 'clear'}</Badge></div>
          <div className="mt-4 space-y-2.5">
            {attention.length ? attention.map((a:any,i:number)=>(
              <Link key={i} href={a.href} className="flex items-center justify-between gap-3 rounded-xl border border-[#e5e1d7] p-3 hover:bg-[#f4f1e8]">
                <div className="min-w-0"><div className="text-xs font-bold line-clamp-1">{a.message}</div></div>
                <ChevronRight size={14} className="shrink-0 text-[#77798a]"/>
              </Link>
            )) : <div className="rounded-xl bg-[#f4f1e8] p-4 text-xs text-[#77798a]">All clear — nothing needs attention.</div>}
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between"><h3 className="font-bold flex items-center gap-2"><Calendar size={16} className="text-[#5aafbd]"/> Upcoming deadlines</h3></div>
          <div className="mt-4 space-y-2.5">
            {deadlines.length ? deadlines.map((d:any,i:number)=>(
              <div key={i} className="flex items-center justify-between gap-3 rounded-xl border border-[#e5e1d7] p-3">
                <div className="min-w-0"><div className="text-xs font-bold line-clamp-1">{d.label}</div><div className="text-[11px] text-[#77798a]">{formatDate(d.date)}</div></div>
                <Badge tone={d.daysRemaining <= 2 ? 'coral' : 'muted'}>{d.daysRemaining}d left</Badge>
              </div>
            )) : <div className="rounded-xl bg-[#f4f1e8] p-4 text-xs text-[#77798a]">No upcoming deadlines.</div>}
          </div>
        </Card>
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
                <YAxis tick={{fontSize:11, fill:'#77798a'}} axisLine={false} tickLine={false} allowDecimals={false}/>
                <Tooltip contentStyle={{borderRadius:12, border:'1px solid #dedbd1'}}/>
                <Area type="monotone" dataKey="teams" stroke="#f26a4f" fillOpacity={1} fill="url(#g1)" strokeWidth={2}/>
                <Area type="monotone" dataKey="subs" stroke="#5aafbd" fillOpacity={1} fill="url(#g2)" strokeWidth={2}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex gap-3 text-xs"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#f26a4f]"/>Teams</span><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#5aafbd]"/>Submissions</span></div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between"><h3 className="font-bold">Submission breakdown</h3><Badge tone="dark">{submissions ? Math.round(submissions.rate*100)+'%' : '—'} rate</Badge></div>
          {submissionTotal > 0 ? (
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
          ) : <div className="mt-4 rounded-xl bg-[#f4f1e8] p-8 text-center text-xs text-[#77798a]">No submissions yet.</div>}
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-xl bg-[#f4f1e8] p-3"><div className="font-mono text-lg font-bold">{active?.participantCount ?? summary.totalParticipants}</div><div className="text-[#77798a]">participants</div></div>
            <div className="rounded-xl bg-[#f4f1e8] p-3"><div className="font-mono text-lg font-bold">{active?.teamCount ?? summary.totalTeams}</div><div className="text-[#77798a]">teams</div></div>
            <div className="rounded-xl bg-[#d8e35b] p-3"><div className="font-mono text-lg font-bold">{active?.projectCount ?? 0}</div><div className="text-[#171a2d]">projects</div></div>
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
            <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-[#77798a]">Create your first hackathon. Your hackathon will remain in draft until you review and publish.</p>
            <Link href="/organizer/hackathons/create" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#171a2d] px-4 py-2 text-xs font-bold text-white">Create hackathon <ChevronRight size={14}/></Link>
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
                    <td className="py-3 text-xs">{h.themeCount ?? 0} themes</td>
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
