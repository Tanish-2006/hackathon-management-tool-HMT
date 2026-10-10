import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Github, Layers, ExternalLink, ShieldCheck, Loader2, AlertCircle, Check, X, Edit3, Save, Plus, Users, Calendar, Target, Trophy } from 'lucide-react';
import { hmtBackendService, ApiError } from '@/services/backendApi';
import { useHackathonContext } from '@/hooks/use-hackathon-context';

function friendly(e:unknown){return e instanceof ApiError? e.message : (e as Error)?.message || 'Failed'}

export default function ParticipantProjects(){
  const [project,setProject]=useState<any>(null);
  const [milestones,setMilestones]=useState<any[]>([]);
  const [team,setTeam]=useState<any>(null);
  const [hackathon,setHackathon]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [success,setSuccess]=useState<string|null>(null);
  const [editing,setEditing]=useState(false);
  const [grantStatus,setGrantStatus]=useState<any>(null);
  const [form,setForm]=useState({ title:'', description:'', problemStatement:'', techStack:'', repoUrl:'' });
  const [saving,setSaving]=useState(false);
  const [showMilestone,setShowMilestone]=useState(false);
  const [mForm,setMForm]=useState({ title:'', description:'', dueDate:'' });

  // Hackathon-scoped context: a project belongs to one team in one hackathon.
  const ctx = useHackathonContext();
  const contextId = ctx.selectedId;

  useEffect(()=>{
    // Never show another hackathon's project here while context resolves.
    setProject(null); setTeam(null); setMilestones([]); setGrantStatus(null);
    if(ctx.loading || !contextId) { setLoading(!ctx.loading); return; }
    let m=true;
    async function load(){
      setLoading(true); setError(null);
      try{
        const [h, t, p] = await Promise.allSettled([ hmtBackendService.getHackathonById(contextId), hmtBackendService.getMyTeam(contextId), hmtBackendService.getMyProject(contextId) ]);
        if(!m) return;
        if(h.status==='fulfilled') setHackathon(h.value as any);
        if(t.status==='fulfilled'){
          const tm = (t.value as any)?.team ?? t.value;
          if(tm?.id && (!tm.hackathonId || String(tm.hackathonId)===String(contextId))) setTeam(tm);
          else if((t.value as any)?.id && (!(t.value as any)?.hackathonId || String((t.value as any).hackathonId)===String(contextId))) setTeam(t.value);
          else setTeam(null);
          if((t.value as any)?.team===null) setTeam(null);
        }
        if(p.status==='fulfilled'){
          const proj = (p.value as any)?.project ?? (p.value as any);
          if(proj?.id){ setProject(proj); setForm({ title: proj.title||'', description: proj.description||'', problemStatement: proj.problemStatement||'', techStack: (proj.techStack||[]).join(', '), repoUrl: proj.repoUrl||'' });
            try{ const ms = await hmtBackendService.getProjectMilestones(proj.id); if(m) setMilestones(Array.isArray(ms)?ms: (ms as any)?.milestones||[]); }catch{}
            try{ const st = await hmtBackendService.checkRepositoryAccess(proj.id); if(m) setGrantStatus(st as any); }catch{}
          } else {
            setProject(null);
          }
          // also handle milestones array in p.value
          if((p.value as any)?.milestones) setMilestones((p.value as any).milestones);
        }
      }catch(e){ if(m) setError(friendly(e)); }
      finally{ if(m) setLoading(false); }
    }
    load(); return ()=>{m=false}
  },[ctx.loading, contextId]);

  async function handleSave(e: React.FormEvent){
    e.preventDefault(); setSaving(true); setError(null); setSuccess(null);
    try{
      const payload:any = {
        title: form.title,
        description: form.description,
        problemStatement: form.problemStatement || undefined,
        techStack: form.techStack.split(',').map(s=>s.trim()).filter(Boolean),
        repoUrl: form.repoUrl || undefined,
        // Hackathon context so multi-hackathon participants upsert into the right team.
        hackathonId: contextId || undefined,
      };
      if(!team?.id) throw new Error('You must be in a team to create a project');
      let saved:any;
      if(project?.id){
        saved = await hmtBackendService.updateProject(project.id, payload);
      } else {
        saved = await hmtBackendService.createProject(payload);
      }
      // if backend returns {project: ...} unwrap
      const proj = (saved as any)?.project || saved;
      setProject(proj);
      setSuccess(project?.id ? 'Project updated' : 'Project created');
      setEditing(false);
      if(proj?.id){
        try{ const st = await hmtBackendService.checkRepositoryAccess(proj.id); setGrantStatus(st as any); }catch{}
      }
    }catch(e){ setError(friendly(e)); }
    finally{ setSaving(false); }
  }

  async function handleMilestone(e: React.FormEvent){
    e.preventDefault(); if(!project?.id) return;
    setSaving(true); setError(null);
    try{
      const created = await hmtBackendService.createMilestone(project.id, { title: mForm.title, description: mForm.description, dueDate: mForm.dueDate || undefined });
      setMilestones(prev=> [...prev, created]);
      setShowMilestone(false); setMForm({ title:'', description:'', dueDate:'' }); setSuccess('Milestone added');
    }catch(e){ setError(friendly(e)); }
    finally{ setSaving(false); }
  }

  if(loading) return <div className="space-y-4"><div className="h-24 animate-pulse rounded-2xl bg-[#e9e5da]"/><div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/></div>
  const hasProject = !!project?.id;
  const hasGrant = !!grantStatus?.hasAccess;
  // Honest progress: derived from completed fields, never a fixed placeholder.
  const progress = !hasProject ? 0 : Math.round(
    ([project.title, project.description, project.problemStatement, (project.techStack||[]).length ? 'x' : '', project.repoUrl, milestones.length ? 'x' : ''].filter(Boolean).length / 6) * 100,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">Project · overview</div>
          <h1 className="mt-2 text-3xl font-bold tracking-[-.05em] text-[#171a2d]">Your build, crystallized.</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#77798a]">Title, problem statement, tech stack, team and hackathon context — plus repository connection status that respects grants.</p>
        </div>
        <div className="flex gap-2">
          {hasProject ? <button onClick={()=>setEditing(v=>!v)} className="inline-flex items-center gap-2 rounded-xl border border-[#dedbd1] px-4 py-2 text-xs font-bold bg-white">{editing ? <X size={14}/> : <Edit3 size={14}/>} {editing ? 'Cancel edit' : 'Edit project'}</button> : <button onClick={()=>setEditing(true)} disabled={!!contextId && !ctx.selectedIsRegistered} title={contextId && !ctx.selectedIsRegistered ? 'Register for this hackathon first' : 'Create project'} className="inline-flex items-center gap-2 rounded-xl bg-[#171a2d] px-4 py-2 text-xs font-bold text-white disabled:opacity-40"><Plus size={14}/> Create project</button>}
          <Link href="/participant/github" className="inline-flex items-center gap-2 rounded-xl bg-[#f26a4f] px-4 py-2 text-xs font-bold text-white"><Github size={14}/> GitHub</Link>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex gap-2"><AlertCircle size={16}/>{error}<button onClick={()=>setError(null)} className="ml-auto"><X size={14}/></button></div>}
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 flex gap-2"><Check size={16}/>{success}<button onClick={()=>setSuccess(null)} className="ml-auto"><X size={14}/></button></div>}

      {/* Hackathon context: a project belongs to one team in one hackathon */}
      <div className="rounded-2xl border border-[#dedbd1] bg-[#f4f1e8] px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {ctx.loading ? (
          <span className="text-xs text-[#77798a]">Loading hackathon context…</span>
        ) : !contextId ? (
          <span className="text-xs text-[#55586a]">No hackathon context yet — <Link href="/participant/hackathons" className="font-bold underline">discover and register</Link> to unlock your project workspace.</span>
        ) : (
          <>
            <label className="flex items-center gap-2 text-xs font-semibold text-[#55586a]">Hackathon
              <select
                value={contextId}
                onChange={e=>ctx.select(e.target.value || null)}
                className="rounded-lg border border-[#dedbd1] bg-white px-2 py-1.5 text-xs font-bold text-[#171a2d] outline-none focus:border-[#f26a4f]"
                aria-label="Select hackathon context"
              >
                {ctx.options.map(o=><option key={o.id} value={o.id}>{o.title}{o.registered?'':' (not registered)'}</option>)}
              </select>
            </label>
            {!ctx.selectedIsRegistered && (
              <span className="text-xs text-[#55586a]">Not registered here — project actions unlock after registration. <Link href="/participant/hackathons" className="font-bold underline">Open Discover</Link></span>
            )}
          </>
        )}
      </div>

      {!hasProject && !editing && (contextId ? !ctx.selectedIsRegistered ? (
        <div className="rounded-2xl border border-dashed border-[#dedbd1] bg-[#fdfbf5] p-10 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#f4f1e8]"><Layers size={20}/></div>
          <h3 className="mt-4 text-lg font-bold">Registration required</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#77798a]">Register for {ctx.selectedTitle || 'this hackathon'} to unlock the project workspace — team first, then project.</p>
          <Link href="/participant/hackathons" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#f26a4f] px-4 py-2 text-xs font-bold text-white">Discover & register</Link>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[#dedbd1] bg-[#fdfbf5] p-10 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#f4f1e8]"><Layers size={20}/></div>
          <h3 className="mt-4 text-lg font-bold">No project yet</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#77798a]">You need to be in a team for {ctx.selectedTitle || 'this hackathon'} first (leader or member). Then define your project — it powers AI analysis, judging and your timeline.</p>
          {!team?.id ? <Link href="/participant/teams" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#f26a4f] px-4 py-2 text-xs font-bold text-white">Join or create a team <Users size={14}/></Link> : <button onClick={()=>setEditing(true)} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#171a2d] px-4 py-2 text-xs font-bold text-white">Create project now</button>}
        </div>
      ) : null)}

      {(editing || hasProject) && (
        <div className="grid gap-6 lg:grid-cols-[1.35fr_.65fr]">
          <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
            {editing ? (
              <form onSubmit={handleSave} className="space-y-4">
                <h3 className="font-bold">{hasProject ? 'Edit project' : 'Create project'}</h3>
                {!team?.id && <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">You must be in a team — create or join one at Teams.</div>}
                <label className="block text-xs font-semibold">Title *<input required value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="Afterimage — spatial web companion" className="mt-1 w-full rounded-xl border border-[#dedbd1] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#f26a4f]"/></label>
                <label className="block text-xs font-semibold">Description<textarea required value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} rows={3} placeholder="What you are building and why now." className="mt-1 w-full rounded-xl border border-[#dedbd1] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#f26a4f]"/></label>
                <label className="block text-xs font-semibold">Problem statement<textarea value={form.problemStatement} onChange={e=>setForm(f=>({...f,problemStatement:e.target.value}))} rows={3} placeholder="The specific problem and insight behind your build." className="mt-1 w-full rounded-xl border border-[#dedbd1] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#f26a4f]"/></label>
                <label className="block text-xs font-semibold">Tech stack (comma separated)<input value={form.techStack} onChange={e=>setForm(f=>({...f,techStack:e.target.value}))} placeholder="Next.js, Tailwind, Neo4j, Fastify" className="mt-1 w-full rounded-xl border border-[#dedbd1] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#f26a4f]"/></label>
                {(hackathon as any)?.repoRequirement !== 'DISABLED' && (
                  <label className="block text-xs font-semibold">Repository URL {(hackathon as any)?.repoRequirement === 'REQUIRED' ? '* (required by this hackathon — one primary URL, set by the leader)' : '(optional — leader connects via GitHub flow for grants)'}<input value={form.repoUrl} onChange={e=>setForm(f=>({...f,repoUrl:e.target.value}))} placeholder="https://github.com/org/repo" required={(hackathon as any)?.repoRequirement === 'REQUIRED'} className="mt-1 w-full rounded-xl border border-[#dedbd1] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#f26a4f]"/></label>
                )}
                <div className="flex gap-2 pt-2"><button disabled={saving} className="flex-1 rounded-xl bg-[#f26a4f] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2">{saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>} {saving?'Saving…':'Save project'}</button><button type="button" onClick={()=>setEditing(false)} className="rounded-xl border border-[#dedbd1] px-4 py-2.5 text-sm font-bold">Cancel</button></div>
              </form>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div><h2 className="text-2xl font-bold tracking-tight">{project.title}</h2><p className="mt-2 text-sm leading-6 text-[#77798a]">{project.description}</p></div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${hasGrant?'bg-[#d8e35b] text-[#171a2d]':'bg-[#e9e5da] text-[#77798a]'}`}>{hasGrant?'CONNECTED':'NOT CONNECTED'}</span>
                </div>

                <div className="mt-6 grid gap-4">
                  <div className="rounded-xl bg-[#f4f1e8] p-4"><div className="text-xs font-bold flex items-center gap-2"><Target size={14}/> Problem statement</div><p className="mt-2 text-sm leading-6 text-[#171a2d]">{project.problemStatement || 'No problem statement yet — add one to help judges and AI.'}</p></div>
                  <div className="rounded-xl bg-[#f4f1e8] p-4"><div className="text-xs font-bold">Tech stack</div><div className="mt-2 flex flex-wrap gap-1.5">{(project.techStack||[]).map((t:string)=><span key={t} className="rounded-full bg-white border border-[#dedbd1] px-2.5 py-1 text-xs font-semibold">{t}</span>)}{(project.techStack||[]).length===0 && <span className="text-xs text-[#77798a]">—</span>}</div></div>
                  <div className="rounded-xl border border-[#e5e1d7] p-4">
                    <div className="text-xs font-bold flex items-center gap-2"><Github size={14}/> Repository</div>
                    {hasGrant && project.repoUrl ? (
                      <a href={project.repoUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[#5aafbd] underline">{project.repoUrl} <ExternalLink size={14}/></a>
                    ) : (
                      <div className="mt-2 text-xs leading-5 text-[#77798a]">{project.repoUrl ? 'Repository connected but not granted — hidden until leader grants AI access. Shows as NOT CONNECTED to outsiders.' : 'No repository connected. Ask your team leader to connect via GitHub → grant.'}</div>
                    )}
                    <div className="mt-3 flex gap-2"><Link href="/participant/github" className="rounded-xl bg-[#171a2d] px-3 py-1.5 text-xs font-bold text-white">Manage GitHub</Link><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${hasGrant?'bg-emerald-100 text-emerald-700 border border-emerald-200':'bg-amber-100 text-amber-700 border border-amber-200'}`}>{hasGrant?'GRANTED':'NO GRANT'}</span></div>
                  </div>
                </div>

                <div className="mt-6">
                  <div className="flex items-center justify-between"><h3 className="text-sm font-bold flex items-center gap-2"><Calendar size={14}/> Milestones</h3><button onClick={()=>setShowMilestone(true)} className="rounded-lg border border-[#dedbd1] px-2.5 py-1 text-xs font-semibold">+ Add</button></div>
                  <div className="mt-3 space-y-2">
                    {milestones.length ? milestones.map((m:any)=><div key={m.id} className="flex items-center justify-between rounded-xl border border-[#e5e1d7] px-3 py-2.5"><div><div className="text-xs font-bold">{m.title}</div><div className="text-xs text-[#77798a]">{m.description||''}</div></div><div className="text-[11px] font-mono text-[#77798a]">{m.dueDate ? new Date(m.dueDate).toLocaleDateString():''}</div></div>) : <div className="rounded-xl bg-[#f4f1e8] p-3 text-xs text-[#77798a]">No milestones yet. Add shipping checkpoints.</div>}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl bg-[#171a2d] p-6 text-[#fdfbf5]">
              <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">Progress</div>
              <div className="mt-3 h-2 rounded-full bg-[#252941]"><div className="h-full rounded-full bg-[#d8e35b]" style={{width: `${progress}%`}}/></div>
              <div className="mt-2 flex justify-between text-xs"><span className="text-[#9b9fb1]">Completion</span><span className="font-mono font-bold text-[#d8e35b]">{progress}%</span></div>
              <div className="mt-6 space-y-2 text-xs">
                <div className="flex justify-between rounded-lg bg-[#252941] px-3 py-2"><span className="text-[#9b9fb1]">Team</span><b>{team?.name || '—'}</b></div>
                <div className="flex justify-between rounded-lg bg-[#252941] px-3 py-2"><span className="text-[#9b9fb1]">Members</span><b>{team?.members?.length || 0}</b></div>
                <div className="flex justify-between rounded-lg bg-[#252941] px-3 py-2"><span className="text-[#9b9fb1]">Hackathon</span><b className="truncate max-w-[140px]">{hackathon?.title || '—'}</b></div>
              </div>
              <div className="mt-6 rounded-xl border border-[#2c3047] p-3 text-xs leading-5 text-[#b9bdca]"><ShieldCheck size={14} className="inline mr-1 text-[#5aafbd]"/> Permission-aware: repo URL hidden without grant. Never shows tokens. READ-ONLY to GitHub.</div>
            </div>

            <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
              <h3 className="font-bold">Hackathon context</h3>
              <p className="mt-2 text-xs leading-5 text-[#77798a]">{hackathon?.description || '—'}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">{(hackathon?.phases||[]).map((p:any,i:number)=><span key={i} className="rounded-full bg-[#f4f1e8] px-2 py-1 text-[11px] font-bold">{p.name || p.status}</span>)}</div>
              <div className="mt-4 text-xs">
                <div className="font-bold">Team access</div>
                <div className="mt-2 space-y-1.5 text-[#77798a]">{(team?.members||[]).map((m:any)=><div key={m.id} className="flex justify-between border-b border-[#e5e1d7] py-1"><span>{m.user?.fullName || m.userId.slice(0,8)}</span><span className="font-mono text-[11px]">{m.role}</span></div>)}{(team?.members||[]).length===0 && <span>—</span>}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {showMilestone && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-40 grid place-items-center bg-[#171a2d]/60 p-4">
            <motion.form onSubmit={handleMilestone} initial={{y:8,opacity:0}} animate={{y:0,opacity:1}} className="w-full max-w-md rounded-2xl bg-[#fdfbf5] p-6">
              <h3 className="font-bold">Add milestone</h3>
              <label className="mt-3 block text-xs font-semibold">Title<input value={mForm.title} onChange={e=>setMForm(f=>({...f,title:e.target.value}))} required className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm"/></label>
              <label className="mt-3 block text-xs font-semibold">Description<input value={mForm.description} onChange={e=>setMForm(f=>({...f,description:e.target.value}))} className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm"/></label>
              <label className="mt-3 block text-xs font-semibold">Due date<input type="date" value={mForm.dueDate} onChange={e=>setMForm(f=>({...f,dueDate:e.target.value}))} className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm"/></label>
              <div className="mt-4 flex gap-2"><button disabled={saving} className="flex-1 rounded-xl bg-[#171a2d] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving?<Loader2 size={16} className="animate-spin inline"/>:'Add'}</button><button type="button" onClick={()=>setShowMilestone(false)} className="rounded-xl border border-[#dedbd1] px-4 py-2 text-sm font-bold">Cancel</button></div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
