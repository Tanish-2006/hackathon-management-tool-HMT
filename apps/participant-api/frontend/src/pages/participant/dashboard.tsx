import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { motion } from 'framer-motion';
import { ArrowRight, Clock3, Github, Layers, Sparkles, Users, Trophy, FileText, AlertCircle, CheckCircle2, Zap, Target, Calendar, Megaphone, ShieldCheck, ChevronRight, ExternalLink, Loader2 } from 'lucide-react';
import { hmtBackendService, ApiError } from '@/services/backendApi';

type Hackathon = any;
type Team = any;
type Project = any;

function friendlyError(e: unknown) {
  if (e instanceof ApiError) return e.message;
  return (e as Error)?.message || 'Something went wrong';
}

function Badge({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'coral'|'lime'|'blue'|'dark'|'muted'|'default' }) {
  const map: Record<string,string> = {
    coral: 'bg-[#f26a4f] text-white',
    lime: 'bg-[#d8e35b] text-[#171a2d]',
    blue: 'bg-[#5aafbd] text-white',
    dark: 'bg-[#171a2d] text-[#fdfbf5]',
    muted: 'bg-[#e9e5da] text-[#77798a]',
    default: 'bg-[#e9e5da] text-[#171a2d]',
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${map[tone]}`}>{children}</span>;
}

function Card({ children, className='' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-[#e9e5da] bg-[#fdfbf5] ${className}`}>{children}</div>;
}

function DarkCard({ children, className='' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-[#171a2d] text-[#fdfbf5] ${className}`}>{children}</div>;
}

function Skeleton({ className='' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-[#e9e5da] ${className}`} />;
}

export default function ParticipantDashboard() {
  const [hackathon, setHackathon] = useState<Hackathon | null>(null);
  const [team, setTeam] = useState<any>(null);
  const [project, setProject] = useState<any>(null);
  const [timeline, setTimeline] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [repoStatus, setRepoStatus] = useState<{ hasAccess: boolean; status?: string } | null>(null);
  const [aiAccess, setAiAccess] = useState<any>(null);
  const [registration, setRegistration] = useState<any>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true); setError(null);
      try {
        const [h, t, proj] = await Promise.allSettled([
          hmtBackendService.getCurrentHackathon(),
          hmtBackendService.getMyTeam(),
          hmtBackendService.getMyProject(),
        ]);
        if (!mounted) return;
        const hv = h.status === 'fulfilled' ? (h.value as any) : null;
        // A rejected hackathon fetch is a real failure (auth/network/server) —
        // surface it instead of masquerading as "no hackathon published yet".
        // Genuine emptiness resolves successfully with null.
        if (h.status === 'rejected') {
          if (mounted) setError(friendlyError(h.reason));
          if (mounted) setLoading(false);
          return;
        }
        setHackathon(hv);
        // Registration + AI availability (backend-derived, operational home only).
        if (hv?.id) {
          hmtBackendService.getMyRegistrations().then((regs:any)=>{
            const list = Array.isArray(regs)?regs:(regs?.data??[]);
            if(mounted) setRegistration(list.find((r:any)=>r.hackathonId===hv.id) ?? null);
          }).catch(()=>null);
          hmtBackendService.getAiAccessStatus().then(r=>{ if(mounted) setAiAccess(r); }).catch(()=>null);
        }

        if (t.status === 'fulfilled') {
          const teamData = (t.value as any)?.team ?? t.value;
          // normalize: backend returns team or {team:null}
          if (teamData && teamData.id) setTeam(teamData);
          else if ((t.value as any)?.id) setTeam(t.value);
          else setTeam(teamData || null);
        }
        if (proj.status === 'fulfilled') {
          const p = (proj.value as any)?.project ?? proj.value;
          setProject(p && p.id ? p : null);
          if (p?.id) {
            hmtBackendService.checkRepositoryAccess(p.id).then(r=> setRepoStatus(r as any)).catch(()=> setRepoStatus({ hasAccess:false }));
          }
        }
        // timeline best effort
        hmtBackendService.getTimeline().then(setTimeline).catch(()=>null);
      } catch (e) { if (mounted) setError(friendlyError(e)); }
      finally { if (mounted) setLoading(false); }
    }
    load();
    return () => { mounted=false; };
  }, []);

  const phase = hackathon?.phases?.find((p:any)=>p.status==='ACTIVE') || hackathon?.phases?.[0];
  const announcements = hackathon?.announcements?.slice(0,3) || [];
  const daysLeft = hackathon?.endDate ? Math.max(0, Math.ceil((new Date(hackathon.endDate).getTime() - Date.now())/86400000)) : null;
  const hasTeam = !!team && !!team.id;
  const hasProject = !!project && !!project.id;

  if (loading) {
    return <div className="space-y-6">
      <Skeleton className="h-28" />
      <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-40"/><Skeleton className="h-40"/><Skeleton className="h-40"/></div>
      <Skeleton className="h-64" />
    </div>;
  }

  if (error) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 flex items-start gap-3"><AlertCircle size={18}/><div><b>Could not load dashboard</b><p className="mt-1 text-red-600">{error}</p><button onClick={()=>location.reload()} className="mt-3 rounded-lg bg-[#171a2d] px-3 py-1.5 text-xs font-bold text-white">Retry</button></div></div>;
  }

  return (
    <div className="space-y-8">
      {/* Header — operational home: what do I need to do right now? */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">Home — what needs you now</div>
          <h1 className="mt-2 text-3xl font-bold tracking-[-.05em] text-[#171a2d] sm:text-[36px]">Your hackathon, in motion.</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#77798a]">
            {hackathon
              ? `${hackathon.derivedStatus ?? 'Published'} · ${registration ? 'Registered' : 'Not registered yet'} · ${hasTeam ? 'In a team' : 'No team yet'} · AI ${aiAccess?.allowed ? 'available' : 'locked'}`
              : 'Discover a published hackathon to begin.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/participant/hackathons" className="inline-flex items-center gap-2 rounded-xl border border-[#dedbd1] px-4 py-3 text-sm font-bold hover:bg-[#f4f1e8]">Discover</Link>
          <Link href="/participant/ai" className="inline-flex items-center gap-2 rounded-xl bg-[#171a2d] px-4 py-3 text-sm font-bold text-white hover:bg-[#252941]"><Sparkles size={16}/> {aiAccess?.allowed ? 'Ask AI teammate' : 'AI locked'} <ArrowRight size={14}/></Link>
        </div>
      </div>
      {hackathon && !registration && (
        <div className="rounded-2xl border border-[#f26a4f]/30 bg-[#fff7ea] p-4 text-sm"><b>Next action:</b> register for {hackathon.title} — your skill profile is reused, no repeated forms. <Link href="/participant/hackathons" className="underline font-bold">Open Discover → Register</Link></div>
      )}
      {hackathon && aiAccess && !aiAccess.allowed && (
        <div className="rounded-2xl border border-[#dedbd1] bg-[#f4f1e8] p-4 text-xs text-[#55586a]">AI Teammate: <b>{aiAccess.code === 'HACKATHON_NOT_LIVE' ? `locked (${aiAccess.derivedStatus})` : aiAccess.message}</b> — backend enforced, available only in the live window.</div>
      )}

      {/* Current hackathon hero */}
      {hackathon ? (
        <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} className="overflow-hidden rounded-[20px] border border-[#dedbd1] bg-[#fdfbf5]">
          <div className="grid lg:grid-cols-[1.35fr_.75fr]">
            <div className="p-6 sm:p-8">
              <div className="flex items-center gap-2">
                <Badge tone="lime">{hackathon.derivedStatus ?? (hackathon.isPublished ? 'PUBLISHED' : 'LIVE')}</Badge>
                {phase && <Badge tone="dark">{phase.name || phase.status}</Badge>}
                {daysLeft !== null && <span className="font-mono text-xs text-[#77798a]">{daysLeft}d remaining</span>}
                {registration && <Badge tone="blue">Registered</Badge>}
              </div>
              <h2 className="mt-4 text-2xl font-bold tracking-[-.04em] text-[#171a2d]">{hackathon.title || hackathon.name || 'HMT Hackathon'}</h2>
              <p className="mt-2 text-sm leading-6 text-[#77798a] line-clamp-3">{hackathon.description || 'Build enterprise-grade AI applications and autonomous agents.'}</p>

              <div className="mt-6 grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-[#f4f1e8] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#77798a]">Phase</div><div className="mt-1 text-sm font-bold">{phase?.name || 'Foundation & Security'}</div><div className="text-xs text-[#5aafbd]">{phase?.status || 'ACTIVE'}</div></div>
                <div className="rounded-xl bg-[#f4f1e8] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#77798a]">Timeline</div><div className="mt-1 text-sm font-bold">{hackathon.startDate ? new Date(hackathon.startDate).toLocaleDateString() : '—'} → {hackathon.endDate ? new Date(hackathon.endDate).toLocaleDateString() : '—'}</div><div className="text-xs text-[#77798a]">{hackathon.judgingCriteria?.length || 3} criteria</div></div>
                <div className="rounded-xl bg-[#f4f1e8] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#77798a]">Problem</div><div className="mt-1 line-clamp-2 text-xs leading-5 text-[#171a2d]">{hackathon.problemStatement?.slice(0,110) || 'Build an AI teammate companion.'}</div></div>
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                <Link href="/participant/hackathons" className="rounded-xl border border-[#dedbd1] px-3 py-2 text-xs font-bold hover:bg-[#f4f1e8]">View hackathon details <ChevronRight size={14} className="ml-1 inline"/></Link>
                <Link href="/participant/projects" className="rounded-xl bg-[#f26a4f] px-3 py-2 text-xs font-bold text-white">Go to project</Link>
              </div>
            </div>
            <div className="border-t border-[#e5e1d7] bg-[#171a2d] p-6 text-[#fdfbf5] lg:border-l lg:border-t-0">
              <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">Deadlines & announcements</div>
              <div className="mt-4 space-y-3">
                {announcements.length ? announcements.map((a:any)=> (
                  <div key={a.id} className="rounded-xl bg-[#252941] p-3">
                    <div className="flex items-center gap-2 text-xs font-bold"><Megaphone size={14} className="text-[#d8e35b]"/>{a.title}</div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#b9bdca]">{a.content}</p>
                  </div>
                )) : <div className="rounded-xl bg-[#252941] p-4 text-xs text-[#9b9fb1]">No announcements yet. We will surface published updates here.</div>}
              </div>
              <div className="mt-6 flex items-center gap-2 text-xs text-[#9b9fb1]"><Clock3 size={14}/> Submission window closes in <b className="text-[#fdfbf5]">{daysLeft ?? '—'} days</b></div>
              <Link href="/participant/hackathons" className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-[#d8e35b]">All announcements <ArrowRight size={13}/></Link>
            </div>
          </div>
        </motion.div>
      ) : (
        <Card className="p-8 text-center">
          <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-[#f4f1e8]"><Layers size={18}/></div>
          <h3 className="mt-3 font-bold">No hackathon published yet</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-[#77798a]">When organizers publish a hackathon, it will appear here with phases, deadlines and announcements.</p>
        </Card>
      )}

      {/* Team / Project / Deadlines grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Team */}
        <Card className="p-6">
          <div className="flex items-center justify-between"><h3 className="font-bold tracking-tight flex items-center gap-2"><Users size={16} className="text-[#f26a4f]"/> Your team</h3><Badge tone={hasTeam ? 'lime' : 'muted'}>{hasTeam ? 'ACTIVE' : 'NO TEAM'}</Badge></div>
          {hasTeam ? (
            <div className="mt-4">
              <div className="text-lg font-bold">{team.name}</div>
              <div className="mt-1 text-xs text-[#77798a]">{team.members?.length || team._count?.members || '—'} members · {team.visibility || 'TEAM_DISCOVERABLE'}</div>
              <div className="mt-4 flex -space-x-2">
                {(team.members || []).slice(0,6).map((m:any, i:number)=> (
                  <span key={m.id || i} className="grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-[#5aafbd] text-[11px] font-bold text-[#171a2d]">{(m.user?.fullName || m.userId || '?').slice(0,2).toUpperCase()}</span>
                ))}
                {(team.members?.length||0)===0 && <span className="text-xs text-[#77798a]">Members hidden until you join</span>}
              </div>
              <div className="mt-5 flex gap-2">
                <Link href="/participant/teams" className="flex-1 rounded-xl bg-[#171a2d] px-3 py-2 text-center text-xs font-bold text-white">Manage team</Link>
                <Link href={`/participant/teams`} className="rounded-xl border border-[#dedbd1] px-3 py-2 text-xs font-semibold">Discover</Link>
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <p className="text-sm leading-6 text-[#77798a]">You are not in a team yet. Discover teams by skill or create your own.</p>
              <Link href="/participant/teams" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#f26a4f] px-4 py-2 text-xs font-bold text-white">Find a team <ArrowRight size={14}/></Link>
            </div>
          )}
        </Card>

        {/* Project */}
        <Card className="p-6">
          <div className="flex items-center justify-between"><h3 className="font-bold flex items-center gap-2"><FileText size={16} className="text-[#5aafbd]"/> Your project</h3>
            <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${repoStatus?.hasAccess ? 'bg-[#d8e35b] text-[#171a2d]' : 'bg-[#e9e5da] text-[#77798a]'}`}>{repoStatus?.hasAccess ? 'CONNECTED' : 'NOT CONNECTED'}</span>
          </div>
          {hasProject ? (
            <div className="mt-4">
              <div className="text-lg font-bold line-clamp-1">{project.title}</div>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#77798a]">{project.description || 'No description yet.'}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(project.techStack || []).slice(0,4).map((t:string)=> <span key={t} className="rounded-full bg-[#f4f1e8] px-2 py-1 text-[10px] font-semibold">{t}</span>)}
                {(!project.techStack || project.techStack.length===0) && <span className="text-xs text-[#aaa9a2]">No tech stack</span>}
              </div>
              <div className="mt-3 text-xs"><span className="font-semibold">Repo:</span> {repoStatus?.hasAccess && project.repoUrl ? <a href={project.repoUrl} target="_blank" rel="noreferrer" className="text-[#5aafbd] underline inline-flex items-center gap-1">{project.repoUrl.slice(0,34)} <ExternalLink size={12}/></a> : <span className="text-[#77798a]">Hidden — grant required</span>}</div>
              <div className="mt-4 flex gap-2">
                <Link href="/participant/projects" className="flex-1 rounded-xl bg-[#171a2d] px-3 py-2 text-center text-xs font-bold text-white">Open project</Link>
                <Link href="/participant/github" className="rounded-xl border border-[#dedbd1] px-3 py-2 text-xs font-semibold inline-flex items-center gap-1"><Github size={14}/> GitHub</Link>
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <p className="text-sm leading-6 text-[#77798a]">No project yet. Create your project overview, problem statement and tech stack.</p>
              <Link href="/participant/projects" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#171a2d] px-4 py-2 text-xs font-bold text-white">Create project <ArrowRight size={14}/></Link>
            </div>
          )}
        </Card>

        {/* Tasks / Evaluation preview */}
        <DarkCard className="p-6">
          <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">Progress & evaluation</div>
          <h3 className="mt-2 text-lg font-bold">Keep shipping</h3>
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-3 rounded-xl bg-[#252941] p-3"><div className="grid h-8 w-8 place-items-center rounded-lg bg-[#d8e35b] text-[#171a2d]"><Target size={16}/></div><div><div className="text-xs font-bold">Phase progress</div><div className="text-xs text-[#9b9fb1]">{timeline?.phaseProgress?.length || 0} updates · {timeline?.phaseProgress?.[0]?.status || 'In progress'}</div></div></div>
            <div className="flex items-center gap-3 rounded-xl bg-[#252941] p-3"><div className="grid h-8 w-8 place-items-center rounded-lg bg-[#5aafbd] text-[#171a2d]"><Trophy size={16}/></div><div><div className="text-xs font-bold">Evaluation</div><div className="text-xs text-[#9b9fb1]">{timeline?.evaluations?.length || 0} scores · mentor feedback {timeline?.feedbacks?.length || 0}</div></div></div>
            <div className="rounded-xl border border-[#2c3047] p-3">
              <div className="flex items-center justify-between text-xs"><span className="text-[#9b9fb1]">Project completeness</span><span className="font-mono text-[#d8e35b]">{hasProject ? '64%' : '12%'}</span></div>
              <div className="mt-2 h-2 rounded-full bg-[#252941]"><div className="h-full rounded-full bg-[#d8e35b]" style={{ width: hasProject ? '64%' : '12%' }}/></div>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Link href="/participant/performance" className="rounded-xl bg-[#fdfbf5] px-3 py-2 text-center text-xs font-bold text-[#171a2d]">View performance</Link>
            <Link href="/participant/ai" className="rounded-xl border border-[#3a3e5a] px-3 py-2 text-center text-xs font-bold">Ask AI</Link>
          </div>
        </DarkCard>
      </div>

      {/* Bottom row */}
      <div className="grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
        <Card className="p-6">
          <div className="flex items-center justify-between"><h3 className="font-bold flex items-center gap-2"><Calendar size={16}/> Hackathon context</h3><Badge tone="muted">Phase-aware</Badge></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-[#f4f1e8] p-4"><div className="text-xs font-bold">Judging criteria</div><div className="mt-2 space-y-1.5">{(hackathon?.judgingCriteria||[]).slice(0,3).map((c:any,i:number)=><div key={i} className="flex justify-between text-xs"><span className="text-[#77798a]">{c.name || c.criteria || `Criteria ${i+1}`}</span><span className="font-mono font-bold">{c.weight ? `${Math.round(c.weight*100)}%` : '—'}</span></div>)}{(hackathon?.judgingCriteria||[]).length===0 && <div className="text-xs text-[#77798a]">Technical Depth 35% · AI Teammate 35% · UX 30%</div>}</div></div>
            <div className="rounded-xl bg-[#f4f1e8] p-4"><div className="text-xs font-bold">Resources</div><div className="mt-2 space-y-1.5">{(hackathon?.resources||[]).slice(0,3).map((r:any,i:number)=><a key={i} href={r.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-[#5aafbd] underline">{r.name || r.title}<ExternalLink size={11}/></a>)}{(hackathon?.resources||[]).length===0 && <div className="text-xs text-[#77798a]">Participant API Specs · Neo4j Graph Schema</div>}</div></div>
          </div>
          <div className="mt-4 rounded-xl border border-dashed border-[#dedbd1] p-4">
            <div className="flex items-start gap-2 text-xs leading-5 text-[#77798a]"><ShieldCheck size={14} className="mt-0.5 text-[#5aafbd]"/><span><b className="text-[#171a2d]">Read-only by default.</b> Repository URLs and AI deep analysis are hidden until your team leader grants access.</span></div>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="font-bold flex items-center gap-2"><Zap size={16} className="text-[#f26a4f]"/> Quick actions</h3>
          <div className="mt-4 grid gap-2">
            <Link href="/participant/teams" className="flex items-center justify-between rounded-xl border border-[#dedbd1] p-3 hover:bg-[#f4f1e8]"><span className="text-sm font-semibold">Discover teams</span><ChevronRight size={16} className="text-[#77798a]"/></Link>
            <Link href="/participant/projects" className="flex items-center justify-between rounded-xl border border-[#dedbd1] p-3 hover:bg-[#f4f1e8]"><span className="text-sm font-semibold">Update project</span><ChevronRight size={16} className="text-[#77798a]"/></Link>
            <Link href="/participant/github" className="flex items-center justify-between rounded-xl border border-[#dedbd1] p-3 hover:bg-[#f4f1e8]"><span className="text-sm font-semibold flex items-center gap-2"><Github size={14}/> Connect GitHub</span><span className={`text-[10px] font-bold px-2 py-1 rounded-full ${repoStatus?.hasAccess ? 'bg-[#d8e35b] text-[#171a2d]' : 'bg-[#f26a4f] text-white'}`}>{repoStatus?.hasAccess?'GRANTED':'CONNECT'}</span></Link>
            <Link href="/participant/performance" className="flex items-center justify-between rounded-xl bg-[#171a2d] p-3 text-white"><span className="text-sm font-bold">See feedback & scores</span><ArrowRight size={16}/></Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
