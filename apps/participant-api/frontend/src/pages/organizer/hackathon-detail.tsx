import { useEffect, useState } from 'react';
import { Link, useParams, useLocation } from 'wouter';
import { AlertCircle, ArrowLeft, Calendar, CheckCircle2, Clock3, ExternalLink, FileText, Layers, Loader2, ShieldCheck, Sparkles, Users, Star, ChevronRight, Trash2, Edit2 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { organizerApi, OrganizerApiError } from '@/services/organizerApi';

function Badge({children,tone='muted'}:any){ const m:any={ lime:'bg-[#d8e35b] text-[#171a2d]', coral:'bg-[#f26a4f] text-white', blue:'bg-[#5aafbd] text-white', dark:'bg-[#171a2d] text-white', muted:'bg-[#e9e5da] text-[#77798a]' }; return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${m[tone]||m.muted}`}>{children}</span> }
function Card({children,className=''}:{children:React.ReactNode;className?:string}){ return <div className={`rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] ${className}`}>{children}</div> }

export default function OrganizerHackathonDetail(){
  const params = useParams<{id:string}>();
  const id = (params as any).id || (params as any).hackathonId;
  const [, setLocation] = useLocation();
  const [hackathon,setHackathon]=useState<any|null>(null);
  const [phases,setPhases]=useState<any[]>([]);
  const [resources,setResources]=useState<any[]>([]);
  const [criteria,setCriteria]=useState<any[]>([]);
  const [assignments,setAssignments]=useState<any[]>([]);
  const [participants,setParticipants]=useState<any[]>([]);
  const [teams,setTeams]=useState<any[]>([]);
  const [analytics,setAnalytics]=useState<any|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [actionMsg,setActionMsg]=useState<string|null>(null);
  const [actionErr,setActionErr]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  // Archive danger zone: modal visibility + mandatory acknowledgement checkbox.
  const [showArchive, setShowArchive] = useState(false);
  const [archiveChecked, setArchiveChecked] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const load = async()=>{
    setLoading(true); setError(null);
    try{
      const h = await organizerApi.getHackathon(id);
      setHackathon(h);
      const [ph,res,cr,ms,an] = await Promise.allSettled([
        organizerApi.listPhases(id).catch(()=>[]),
        organizerApi.listResources(id).catch(()=>[]),
        organizerApi.listCriteria(id).catch(()=>[]),
        organizerApi.listMentorAssignments(id).catch(()=>[]),
        organizerApi.getAnalytics(id).catch(()=>null),
      ]);
      if(ph.status==='fulfilled') setPhases(ph.value as any);
      if(res.status==='fulfilled') setResources(res.value as any);
      if(cr.status==='fulfilled') setCriteria(cr.value as any);
      if(ms.status==='fulfilled') setAssignments(ms.value as any);
      if(an.status==='fulfilled') setAnalytics(an.value as any);
      // participants/teams best effort (needs ownership)
      organizerApi.listParticipants(id).then(setParticipants).catch(()=>setParticipants([]));
      organizerApi.listTeams(id).then(setTeams).catch(()=>setTeams([]));
    }catch(e:any){
      if(e instanceof OrganizerApiError && e.status===403) setError('Not owner — only the organizing owner or ADMIN can view this DRAFT/REVIEW/CONFIRMED workspace.');
      else setError(e.message || 'Failed to load hackathon')
    } finally{ setLoading(false)}
  };
  useEffect(()=>{ if(id) load(); },[id]);

  async function doArchive(){
    // Confirm button is disabled until the checkbox is checked; double-guard here.
    if (!archiveChecked || archiving) return;
    setArchiving(true); setActionMsg(null); setActionErr(null);
    try{
      const res:any = await organizerApi.transitionArchive(id);
      const updated = res.hackathon || res;
      setHackathon(updated);
      setActionMsg(`Hackathon archived — now read-only`);
      setShowArchive(false); setArchiveChecked(false);
    }catch(e:any){ setActionErr(e.message)} finally{ setArchiving(false)}
  }

  async function doTransition(kind:'review'|'confirm'|'publish'){
    setBusy(true); setActionMsg(null); setActionErr(null);
    try{
      let res:any;
      if(kind==='review') res=await organizerApi.transitionReview(id);
      if(kind==='confirm') res=await organizerApi.transitionConfirm(id);
      if(kind==='publish') res=await organizerApi.transitionPublish(id);
      const updated = res.hackathon || res;
      setHackathon(updated);
      setActionMsg(`Transition to ${updated.status} successful`);
      if(kind==='publish' && res.publishedEvent){
        setActionMsg(`Published! Event v${res.publishedEvent.version} type ${res.publishedEvent.type}`);
      }
    }catch(e:any){ setActionErr(e.message)} finally{ setBusy(false)}
  }

  if(loading) return <div className="space-y-4"><div className="h-24 animate-pulse rounded-2xl bg-[#e9e5da]"/><div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/></div>
  if(error) return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 flex gap-3"><AlertCircle size={18}/><div><b>Could not load hackathon</b><p className="mt-1">{error}</p><button onClick={load} className="mt-3 rounded-lg bg-[#171a2d] px-3 py-1.5 text-xs font-bold text-white">Retry</button></div></div>
  if(!hackathon) return <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-8 text-center text-sm text-[#77798a]">Hackathon not found</div>

  const chartData = phases.map((p:any)=> ({ name: p.name.slice(0,6), order: p.order }));
  const publishReady = hackathon.status==='CONFIRMED';
  const canEdit = ['DRAFT','REVIEW'].includes(hackathon.status);

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Link href="/organizer/hackathons" className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] p-2"><ArrowLeft size={16}/></Link>
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">Organizer · workspace · {hackathon.status}</div>
          <h1 className="text-2xl font-bold tracking-[-.04em] truncate">{hackathon.title}</h1>
          <p className="text-xs text-[#77798a] line-clamp-1">{hackathon.description}</p>
        </div>
        <span className="ml-auto hidden sm:inline-flex"><Badge tone={hackathon.status==='PUBLISHED'?'lime':hackathon.status==='DRAFT'?'muted':hackathon.status==='REVIEW'?'blue':hackathon.status==='CONFIRMED'?'coral':'dark'}>{hackathon.status}</Badge></span>
      </div>

      {actionMsg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 flex gap-2"><CheckCircle2 size={16}/>{actionMsg}<button onClick={()=>setActionMsg(null)} className="ml-auto text-xs font-bold">×</button></div>}
      {actionErr && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2"><AlertCircle size={16}/>{actionErr}<button onClick={()=>setActionErr(null)} className="ml-auto text-xs font-bold">×</button></div>}

      {/* Publish controls */}
      <Card className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-xs">
          <ShieldCheck size={16} className="text-[#5aafbd]"/><span className="font-bold">Publish controls</span><span className="text-[#77798a]">DRAFT→REVIEW→CONFIRMED→PUBLISHED</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={()=>doTransition('review')} disabled={busy || hackathon.status!=='DRAFT'} className="rounded-xl bg-[#5aafbd] px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{busy?'…':'→ REVIEW'}</button>
          <button onClick={()=>doTransition('confirm')} disabled={busy || hackathon.status!=='REVIEW'} className="rounded-xl bg-[#f26a4f] px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{busy?'…':'→ CONFIRMED'}</button>
          <button onClick={()=>doTransition('publish')} disabled={busy || !publishReady} className="rounded-xl bg-[#d8e35b] px-3 py-2 text-xs font-bold text-[#171a2d] disabled:opacity-40">{busy?'…':'→ PUBLISHED'}</button>
        </div>
      </Card>

      {hackathon.status==='ARCHIVED' && <div className="rounded-2xl border border-[#dedbd1] bg-[#171a2d] p-4 flex items-start gap-3"><ShieldCheck size={16} className="mt-0.5 text-[#d8e35b]"/><div className="text-xs leading-5"><b className="text-white">ARCHIVED</b><span className="text-[#b9bdca]"> — This hackathon is archived and read-only.</span></div></div>}

      {/* Administrative actions — archive lives here, never with publish controls */}
      {hackathon.status==='PUBLISHED' && (
        <Card className="p-4 border-red-200">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs">
              <div className="font-bold">Administrative Actions</div>
              <div className="mt-1 text-[#77798a]">Archive this completed hackathon and make it read-only.</div>
            </div>
            <button onClick={()=>{ setArchiveChecked(false); setShowArchive(true); }} disabled={busy} className="rounded-xl border border-red-300 px-4 py-2 text-xs font-bold text-[#d74635] hover:bg-red-50 disabled:opacity-40">Archive Hackathon</button>
          </div>
        </Card>
      )}

      {showArchive && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#171a2d]/60 p-5" role="dialog" aria-modal="true" aria-label="Archive this hackathon?">
          <div className="w-full max-w-md rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
            <h2 className="text-lg font-bold tracking-tight">Archive this hackathon?</h2>
            <p className="mt-2 text-xs leading-5 text-[#77798a]">Archiving permanently closes this hackathon for normal operational activity. The hackathon and its historical data will remain available in read-only mode.</p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-5 text-[#51546a]">
              <li>Registration will be closed.</li>
              <li>Participants and teams cannot be modified through normal workflows.</li>
              <li>New submissions cannot be accepted.</li>
              <li>Evaluations cannot be changed through normal workflows.</li>
              <li>Hackathon configuration becomes read-only.</li>
              <li>Historical data, results, projects, and analytics remain available.</li>
              <li>The archived state is terminal in the normal workflow.</li>
              <li>This action cannot be undone through the normal UI workflow.</li>
            </ul>
            <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-xl bg-[#f4f1e8] p-3 text-xs font-semibold">
              <input type="checkbox" checked={archiveChecked} onChange={e=>setArchiveChecked(e.target.checked)} className="mt-0.5"/>
              <span>I understand that this hackathon will become archived and read-only.</span>
            </label>
            <div className="mt-4 flex gap-2">
              <button onClick={doArchive} disabled={!archiveChecked || archiving} className="flex-1 rounded-xl bg-[#d74635] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40">{archiving ? 'Archiving…' : 'Archive Hackathon'}</button>
              <button onClick={()=>{ setShowArchive(false); setArchiveChecked(false); }} disabled={archiving} className="flex-1 rounded-xl border border-[#dedbd1] px-4 py-2.5 text-xs font-bold disabled:opacity-40">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Hero */}
      <div className="grid gap-6 lg:grid-cols-[1.4fr_.8fr]">
        <Card className="p-6">
          <div className="flex items-start justify-between">
            <div><h2 className="font-bold">Overview</h2><p className="mt-1 text-sm leading-6 text-[#77798a]">{hackathon.description}</p></div>
            <span className="rounded-full bg-[#f4f1e8] px-2 py-1 font-mono text-[10px]">v{hackathon.version}</span>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-[#f4f1e8] p-3"><div className="font-mono text-[10px] uppercase text-[#77798a]">Type</div><div className="mt-1 text-sm font-bold">{hackathon.hackathonType}</div><div className="text-xs text-[#77798a]">{hackathon.mode} · {hackathon.duration}</div></div>
            <div className="rounded-xl bg-[#f4f1e8] p-3"><div className="font-mono text-[10px] uppercase text-[#77798a]">Problem</div><div className="mt-1 text-xs leading-5 line-clamp-3">{hackathon.problemStatement || (hackathon.hackathonType==='OPEN_INNOVATION' ? 'Open objective — no fixed problem' : '—')}</div></div>
            <div className="rounded-xl bg-[#f4f1e8] p-3"><div className="font-mono text-[10px] uppercase text-[#77798a]">Objective</div><div className="mt-1 text-xs leading-5 line-clamp-3">{hackathon.objective || '—'}</div></div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-[#e9e5da] px-2.5 py-1 text-[10px] font-bold uppercase">Audience: {hackathon.audience || '—'}</span>
            <span className="rounded-full bg-[#e9e5da] px-2.5 py-1 text-[10px] font-bold uppercase">{hackathon.rules?.length||0} rules</span>
            <span className="rounded-full bg-[#d8e35b] px-2.5 py-1 text-[10px] font-bold uppercase">{hackathon.themeIds?.length||0} themes</span>
          </div>
          {!canEdit && <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700">Editing locked — only DRAFT/REVIEW can be edited via PATCH /hackathons/:id. This is {hackathon.status}.</div>}
        </Card>

        <div className="rounded-2xl bg-[#171a2d] p-6 text-[#fdfbf5]">
          <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">Analytics snapshot</div>
          {analytics ? (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-[#252941] p-3"><div className="font-mono text-xl"> {analytics.participantCount}</div><div className="text-[11px] text-[#9b9fb1]">participants</div></div>
                <div className="rounded-xl bg-[#252941] p-3"><div className="font-mono text-xl">{analytics.teamCount}</div><div className="text-[11px] text-[#9b9fb1]">teams</div></div>
                <div className="rounded-xl bg-[#d8e35b] p-3 text-[#171a2d]"><div className="font-mono text-xl font-bold">{analytics.projectCount}</div><div className="text-[11px]">projects</div></div>
              </div>
              <div className="rounded-xl bg-[#252941] p-3">
                <div className="flex justify-between text-xs"><span className="text-[#9b9fb1]">Submission rate</span><span className="font-mono text-[#d8e35b]">{Math.round((analytics.submissionStatus?.submissionRate||0)*100)}%</span></div>
                <div className="mt-2 h-2 rounded-full bg-[#1a1d2f]"><div className="h-full rounded-full bg-[#d8e35b]" style={{width:`${Math.round((analytics.submissionStatus?.submissionRate||0)*100)}%`}}/></div>
                <div className="mt-2 text-xs text-[#9b9fb1]">{analytics.submissionStatus?.submitted} submitted · {analytics.submissionStatus?.notSubmitted} pending</div>
              </div>
              <Link href="/organizer/analytics" className="inline-flex items-center gap-1 text-xs font-bold text-[#d8e35b]">Full analytics <ChevronRight size={14}/></Link>
            </div>
          ) : <div className="mt-4 rounded-xl bg-[#252941] p-4 text-xs text-[#9b9fb1]">No analytics yet. Seed demo data or add phases/feedback.</div>}
        </div>
      </div>

      {/* Phases */}
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <h3 className="font-bold flex items-center gap-2"><Calendar size={16}/> Phases · Timeline</h3>
          <Link href="/organizer/hackathons/create" className="text-xs font-bold text-[#5aafbd]">Manage in wizard Step 6</Link>
        </div>
        {phases.length ? (
          <>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {phases.map((p:any)=>(
                <div key={p.id} className="rounded-xl border border-[#e5e1d7] bg-white p-3">
                  <div className="flex items-center justify-between"><span className="text-xs font-bold">#{p.order} {p.name}</span><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${p.status==='ACTIVE'?'bg-[#d8e35b] text-[#171a2d]': p.status==='COMPLETED'?'bg-[#5aafbd] text-white':'bg-[#f4f1e8] text-[#77798a]'}`}>{p.status}</span></div>
                  <div className="mt-2 text-xs text-[#77798a]">{new Date(p.startsAt).toLocaleDateString()} → {new Date(p.endsAt).toLocaleDateString()}</div>
                  <div className="mt-2 flex gap-1">
                    <button onClick={async()=>{ const n=prompt('Edit phase name',p.name); if(!n) return; try{ await organizerApi.updatePhase(p.id,{name:n}); load()}catch(e:any){setActionErr(e.message)}}} disabled={hackathon.status==='ARCHIVED'} className="rounded-lg border border-[#dedbd1] px-2 py-1 text-[11px] font-semibold disabled:opacity-40"><Edit2 size={10} className="inline"/> Edit</button>
                    <button onClick={async()=>{ if(!confirm('Delete phase?')) return; try{ await organizerApi.deletePhase(p.id); setPhases(prev=>prev.filter(x=>x.id!==p.id))}catch(e:any){setActionErr(e.message)}}} disabled={hackathon.status==='ARCHIVED'} className="rounded-lg border border-[#dedbd1] px-2 py-1 text-[11px] font-semibold text-[#f26a4f] disabled:opacity-40"><Trash2 size={10} className="inline"/> Del</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e1d7"/>
                  <XAxis dataKey="name" tick={{fontSize:10, fill:'#77798a'}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fontSize:10, fill:'#77798a'}} axisLine={false} tickLine={false}/>
                  <Tooltip/>
                  <Bar dataKey="order" fill="#f26a4f" radius={[8,8,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : <div className="mt-4 rounded-xl bg-[#f4f1e8] p-4 text-xs text-[#77798a]">No phases configured. Go to wizard Step 6 to add registration → results timeline.</div>}
      </Card>

      {/* Resources, Criteria, Mentors */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-center justify-between"><h3 className="font-bold flex items-center gap-2"><FileText size={16}/> Resources</h3><span className="font-mono text-xs text-[#77798a]">{resources.length}</span></div>
          <div className="mt-4 space-y-2">
            {resources.length ? resources.map((r:any)=><div key={r.id} className="flex items-center justify-between rounded-xl border border-[#e5e1d7] bg-white px-3 py-2 text-sm"><span><b>{r.title}</b> <span className="rounded-full bg-[#f4f1e8] px-2 py-0.5 text-[10px] font-bold ml-1">{r.visibility}</span></span><span className="text-xs text-[#5aafbd]">{r.type}{r.url && <a href={r.url} target="_blank" className="ml-2 underline">Open</a>}</span></div>) : <div className="text-xs text-[#77798a]">No resources. Add in wizard Step 4.</div>}
          </div>
          <div className="mt-4 rounded-xl bg-[#f4f1e8] p-3 text-xs leading-5 text-[#77798a]">Visibility filtered per role. Organizer sees all.</div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between"><h3 className="font-bold flex items-center gap-2"><Star size={16}/> Evaluation criteria</h3><span className="font-mono text-xs text-[#77798a]">{criteria.length}</span></div>
          <div className="mt-4 space-y-2">
            {criteria.length ? criteria.map((c:any)=><div key={c.id} className="flex items-center justify-between rounded-xl bg-[#f4f1e8] px-3 py-2 text-sm"><span><b>{c.name}</b> <span className="text-xs text-[#77798a]">{c.description?.slice(0,40)||''}</span></span><span className="font-mono text-xs font-bold">{c.weight ? Math.round(c.weight*100)+'%' : ''} · max {c.maxScore}</span></div>) : <div className="text-xs text-[#77798a]">No criteria. Add in wizard Step 7. Known examples: Innovation, Technical implementation, Impact, UX...</div>}
          </div>
          <Link href="/organizer/evaluations" className="mt-3 inline-flex text-xs font-bold text-[#f26a4f]">Manage evaluations <ChevronRight size={14}/></Link>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-center justify-between"><h3 className="font-bold flex items-center gap-2"><Users size={16}/> Mentors & assignments</h3><span className="font-mono text-xs text-[#77798a]">{assignments.length}</span></div>
          <div className="mt-4 space-y-2">
            {assignments.length ? assignments.map((a:any)=><div key={a.id} className="flex justify-between rounded-xl border border-[#e5e1d7] bg-white px-3 py-2 text-sm"><span>Mentor {a.mentorId.slice(0,8)} → Team {a.teamId.slice(0,12)}</span><span className="text-xs text-[#77798a]">{new Date(a.assignedAt).toLocaleDateString()}</span></div>) : <div className="text-xs text-[#77798a]">No mentor assignments. Manage mentors in the Mentors section.</div>}
          </div>
          <Link href="/organizer/mentors" className="mt-3 inline-flex text-xs font-bold text-[#5aafbd]">View all mentors <ChevronRight size={14}/></Link>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between"><h3 className="font-bold">Participants & teams</h3><Link href="/organizer/teams" className="text-xs font-bold text-[#f26a4f]">View teams</Link></div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-[#f4f1e8] p-4 text-center"><div className="text-2xl font-bold">{participants.length}</div><div className="text-xs text-[#77798a]">participants</div></div>
            <div className="rounded-xl bg-[#f4f1e8] p-4 text-center"><div className="text-2xl font-bold">{teams.length}</div><div className="text-xs text-[#77798a]">teams</div></div>
          </div>
          {teams.length ? (
            <div className="mt-3 space-y-2 max-h-40 overflow-auto">
              {teams.slice(0,4).map((t:any)=><div key={t.id} className="flex justify-between rounded-xl border border-[#e5e1d7] bg-white px-3 py-2 text-xs"><span><b>{t.name}</b> · {t.memberCount ?? t.members?.length ?? 0} members</span><button onClick={async()=>{ try{ await organizerApi.getPrivateRepo(t.id); setActionMsg('Unexpected: private repo exposed')}catch(e:any){ setActionErr(`Privacy boundary ✓ 403 for team ${t.id.slice(0,8)}: ${e.message}`)}} } className="rounded-lg bg-[#171a2d] px-2 py-1 text-[11px] font-bold text-white">Try private repo</button></div>)}
            </div>
          ) : <div className="mt-3 text-xs text-[#77798a]">No teams yet. Seed demo or wait for participants.</div>}
          <div className="mt-3 flex gap-2">
            <Link href="/organizer/participants" className="flex-1 rounded-xl border border-[#dedbd1] px-3 py-2 text-center text-xs font-semibold">All participants</Link>
            <Link href="/organizer/teams" className="flex-1 rounded-xl bg-[#171a2d] px-3 py-2 text-center text-xs font-bold text-white">All teams</Link>
          </div>
        </Card>
      </div>
    </div>
  )
}
