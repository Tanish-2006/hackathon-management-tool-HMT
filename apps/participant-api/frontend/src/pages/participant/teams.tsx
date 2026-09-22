import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Search, Filter, Sparkles, ArrowRight, LogOut, Check, X, Mail, ShieldCheck, AlertCircle, Loader2, Plus, Compass, Heart, Target, Crown, Eye, UserPlus } from 'lucide-react';
import { hmtBackendService, ApiError } from '@/services/backendApi';

function friendly(e:unknown){ return e instanceof ApiError ? e.message : (e as Error)?.message || 'Failed' }

function Badge({children,tone='muted'}:any){
  const m:any={ lime:'bg-[#d8e35b] text-[#171a2d]', coral:'bg-[#f26a4f] text-white', blue:'bg-[#5aafbd] text-white', dark:'bg-[#171a2d] text-white', muted:'bg-[#e9e5da] text-[#77798a]' }
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${m[tone]||m.muted}`}>{children}</span>
}

export default function ParticipantTeams(){
  const [myTeam,setMyTeam]=useState<any>(null);
  const [discover,setDiscover]=useState<any[]>([]);
  const [candidates,setCandidates]=useState<any[]>([]);
  const [invites,setInvites]=useState<any[]>([]);
  const [search,setSearch]=useState('');
  const [skill,setSkill]=useState('');
  const [loading,setLoading]=useState(true);
  const [actionLoading,setActionLoading]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [success,setSuccess]=useState<string|null>(null);
  const [selectedTeam,setSelectedTeam]=useState<any|null>(null);
  const [showCreate,setShowCreate]=useState(false);
  const [createForm,setCreateForm]=useState({ name:'', requiredSkills:'', maxMembers:'4', hackathonId:'' });
  const [detailTeam,setDetailTeam]=useState<any|null>(null);

  // hackathon id for create
  const [hackathonId,setHackathonId]=useState<string>('');

  useEffect(()=>{
    let m=true;
    async function load(){
      setLoading(true); setError(null);
      try{
        const cur = await hmtBackendService.getCurrentHackathon().catch(()=>null);
        if(cur?.id) setHackathonId(cur.id);
        const [teamRes, discRes, candRes, invRes] = await Promise.allSettled([
          hmtBackendService.getMyTeam(),
          hmtBackendService.discoverTeams({}),
          hmtBackendService.getMatchCandidates(cur?.id),
          hmtBackendService.getMyInvitations(),
        ]);
        if(!m) return;
        if(teamRes.status==='fulfilled'){
          const t = (teamRes.value as any)?.team ?? teamRes.value;
          if(t && t.id) setMyTeam(t); else if((teamRes.value as any)?.id) setMyTeam(teamRes.value);
          else setMyTeam(t?.team ? t.team : null);
          // Normalize: {team:null} => null
          if((teamRes.value as any)?.team===null) setMyTeam(null);
          if((t as any)?.message) {/* no team */}
        }
        if(discRes.status==='fulfilled'){
          const d:any = discRes.value;
          const arr = Array.isArray(d) ? d : d?.data || d?.teams || [];
          setDiscover(arr);
        }
        if(candRes.status==='fulfilled'){
          const c:any = candRes.value;
          setCandidates(c?.candidates || c?.data || []);
        }
        if(invRes.status==='fulfilled'){
          const inv:any = invRes.value;
          setInvites(Array.isArray(inv)?inv: inv?.data||[]);
        }
      }catch(e){ if(m) setError(friendly(e)); }
      finally{ if(m) setLoading(false); }
    }
    load(); return ()=>{m=false}
  },[]);

  const filteredDiscover = useMemo(()=>{
    return discover.filter((t:any)=>{
      const q = search.toLowerCase();
      const s = skill.toLowerCase();
      const hay = `${t.name} ${t.requiredSkills?.join(' ')}`.toLowerCase();
      if(q && !hay.includes(q)) return false;
      if(s && !(t.requiredSkills||[]).some((rs:string)=>rs.toLowerCase().includes(s))) return false;
      return true;
    });
  },[discover,search,skill]);

  async function join(teamId:string){
    setActionLoading(teamId); setError(null); setSuccess(null);
    try{ await hmtBackendService.joinTeam(teamId); setSuccess('Joined team successfully'); const t = await hmtBackendService.getMyTeam(); const team = (t as any)?.team ?? t; setMyTeam(team?.id?team:t); }catch(e){ setError(friendly(e)); }
    finally{ setActionLoading(null); }
  }
  async function leave(){
    setActionLoading('leave'); setError(null);
    try{ await hmtBackendService.leaveTeam(); setMyTeam(null); setSuccess('Left team'); }catch(e){ setError(friendly(e)); }
    finally{ setActionLoading(null); }
  }
  async function acceptInvite(id:string){
    setActionLoading(id); setError(null);
    try{ await hmtBackendService.acceptInvitation(id); setSuccess('Invitation accepted'); const t = await hmtBackendService.getMyTeam(); const team = (t as any)?.team ?? t; setMyTeam(team?.id?team:t); const inv = await hmtBackendService.getMyInvitations(); setInvites(Array.isArray(inv)?inv: (inv as any)?.data||[]); }catch(e){ setError(friendly(e)); }
    finally{ setActionLoading(null); }
  }
  async function declineInvite(id:string){
    setActionLoading(id); try{ await hmtBackendService.declineInvitation(id); setInvites(prev=> prev.filter(i=>i.id!==id)); setSuccess('Invitation declined'); }catch(e){ setError(friendly(e)); } finally{ setActionLoading(null); }
  }
  async function createTeam(e: React.FormEvent){
    e.preventDefault(); setActionLoading('create'); setError(null);
    try{
      const payload:any = { name: createForm.name, hackathonId: hackathonId || createForm.hackathonId, requiredSkills: createForm.requiredSkills.split(',').map(s=>s.trim()).filter(Boolean), maxMembers: Number(createForm.maxMembers)||4 };
      if(!payload.hackathonId) throw new Error('No hackathon context — try reloading');
      const created = await hmtBackendService.createTeam(payload);
      setMyTeam(created);
      setSuccess(`Team "${payload.name}" created — you are leader`); setShowCreate(false);
    }catch(e){ setError(friendly(e)); } finally{ setActionLoading(null); }
  }
  async function openTeamDetail(id:string){
    setSelectedTeam({ id, loading:true });
    try{ const t = await hmtBackendService.getTeamById(id); setDetailTeam(t); setSelectedTeam(t); }catch(e){ setError(friendly(e)); setSelectedTeam(null); }
  }

  if(loading) return <div className="space-y-4"><div className="h-24 animate-pulse rounded-2xl bg-[#e9e5da]"/><div className="grid gap-4 lg:grid-cols-3"><div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/><div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/><div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/></div></div>

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">Teams · Discover & match</div>
          <h1 className="mt-2 text-3xl font-bold tracking-[-.05em] text-[#171a2d]">Find your crew.</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#77798a]">Discover teams, match by complementary skills, handle invitations, join or leave — all permission-aware.</p>
        </div>
        <button onClick={()=>setShowCreate(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#171a2d] px-4 py-3 text-sm font-bold text-white"><Plus size={16}/> Create team</button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2"><AlertCircle size={16} className="mt-0.5"/>{error}<button onClick={()=>setError(null)} className="ml-auto"><X size={14}/></button></div>}
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 flex items-start gap-2"><Check size={16} className="mt-0.5"/>{success}<button onClick={()=>setSuccess(null)} className="ml-auto"><X size={14}/></button></div>}

      {/* My team */}
      <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
        <div className="flex items-center justify-between"><h2 className="font-bold flex items-center gap-2"><Users size={16} className="text-[#f26a4f]"/> My team</h2>{myTeam ? <Badge tone="lime">IN TEAM</Badge> : <Badge tone="muted">NO TEAM</Badge>}</div>
        {myTeam?.id ? (
          <div className="mt-4 grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
            <div>
              <div className="text-xl font-bold">{myTeam.name}</div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-[#77798a]"><span>{myTeam.members?.length || 1} members</span><span>· {myTeam.visibility}</span><span>· {myTeam.isDiscoverable ? 'Discoverable' : 'Private'}</span></div>
              <div className="mt-3 flex flex-wrap gap-1.5">{(myTeam.requiredSkills||[]).map((s:string)=><span key={s} className="rounded-full bg-[#f4f1e8] px-2 py-1 text-[11px] font-semibold">{s}</span>)}</div>
              <div className="mt-4 flex -space-x-2">
                {(myTeam.members||[]).map((m:any,i:number)=>(<span key={m.id||i} className="grid h-9 w-9 place-items-center rounded-full border-2 border-white bg-[#5aafbd] text-xs font-bold text-[#171a2d]">{(m.user?.fullName || m.userId || '?').slice(0,2).toUpperCase()}</span>))}
              </div>
              <div className="mt-5 flex gap-2">
                <button onClick={leave} disabled={!!actionLoading} className="rounded-xl border border-[#dedbd1] px-4 py-2 text-xs font-bold flex items-center gap-2 disabled:opacity-50">{actionLoading==='leave'?<Loader2 size={14} className="animate-spin"/>:<LogOut size={14}/>} Leave team</button>
                <Link href="/participant/projects" className="rounded-xl bg-[#f26a4f] px-4 py-2 text-xs font-bold text-white">Go to project</Link>
              </div>
            </div>
            <div className="rounded-xl bg-[#f4f1e8] p-4">
              <div className="text-xs font-bold flex items-center gap-2"><Crown size={14}/> Team details</div>
              <div className="mt-2 text-xs text-[#77798a]">Your team is linked to hackathon <b className="text-[#171a2d]">{myTeam.hackathonId?.slice(0,8) || hackathonId.slice(0,8) || '—'}</b></div>
              <div className="mt-3 text-xs leading-5 text-[#77798a]">Leaving frees you to join another team. Only the leader can connect a repository and grant AI access.</div>
              <div className="mt-3 flex gap-2">
                <button onClick={()=> myTeam.id && openTeamDetail(myTeam.id)} className="rounded-lg border border-[#dedbd1] bg-white px-3 py-1.5 text-xs font-semibold">View details</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <p className="text-sm leading-6 text-[#77798a]">You are not in a team yet. Browse below, get skill-matched, or create your own team (you become leader).</p>
            <div className="mt-4 flex gap-2">
              <button onClick={()=>setShowCreate(true)} className="rounded-xl bg-[#f26a4f] px-4 py-2 text-xs font-bold text-white">Create team</button>
              <a href="#discover" className="rounded-xl border border-[#dedbd1] px-4 py-2 text-xs font-bold">Discover teams</a>
            </div>
          </div>
        )}
      </div>

      {/* Invitations */}
      <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
        <h3 className="font-bold flex items-center gap-2"><Mail size={16}/> Invitations <Badge tone={invites.length?'coral':'muted'}>{invites.length} pending</Badge></h3>
        {invites.length ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {invites.map((inv:any)=>(
              <div key={inv.id} className="rounded-xl border border-[#e5e1d7] p-4 flex flex-col gap-3">
                <div><div className="text-sm font-bold">Team {String(inv.teamId).slice(0,8)}</div><div className="text-xs text-[#77798a]">{inv.message || 'You are invited to join'}</div><div className="mt-1 text-[11px] font-mono text-[#aaa9a2]">{inv.status} · {inv.inviteeEmail || inv.email}</div></div>
                <div className="flex gap-2">
                  <button onClick={()=>acceptInvite(inv.id)} disabled={!!actionLoading} className="flex-1 rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50 flex items-center justify-center gap-1">{actionLoading===inv.id?<Loader2 size={14} className="animate-spin"/>:<Check size={14}/>} Accept</button>
                  <button onClick={()=>declineInvite(inv.id)} disabled={!!actionLoading} className="rounded-xl border border-[#dedbd1] px-3 py-2 text-xs font-semibold disabled:opacity-50">Decline</button>
                </div>
              </div>
            ))}
          </div>
        ) : <div className="mt-3 rounded-xl bg-[#f4f1e8] p-4 text-xs text-[#77798a]">No pending invitations.</div>}
      </div>

      {/* Discover */}
      <div id="discover" className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="font-bold flex items-center gap-2"><Compass size={16}/> Discover teams</h3>
          <div className="flex gap-2">
            <label className="relative"><Search size={14} className="absolute left-2.5 top-2.5 text-[#aaa9a2]"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search teams" className="h-9 w-44 rounded-xl border border-[#dedbd1] bg-white pl-8 pr-3 text-xs outline-none focus:border-[#f26a4f]"/></label>
            <label className="relative"><Filter size={14} className="absolute left-2.5 top-2.5 text-[#aaa9a2]"/><input value={skill} onChange={e=>setSkill(e.target.value)} placeholder="Skill (React, Python)" className="h-9 w-44 rounded-xl border border-[#dedbd1] bg-white pl-8 pr-3 text-xs outline-none focus:border-[#f26a4f]"/></label>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredDiscover.length ? filteredDiscover.map((team:any)=>(
            <motion.div key={team.id} layout initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="rounded-2xl border border-[#e5e1d7] p-4 bg-white hover:border-[#f26a4f]/50 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div><div className="text-sm font-bold leading-tight">{team.name}</div><div className="mt-1 text-[11px] text-[#77798a]">{team.members?.length||0}/{team.maxMembers||4} members · {team.visibility}</div></div>
                <Badge tone={team.isDiscoverable?'lime':'muted'}>{team.isDiscoverable?'OPEN':'CLOSED'}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">{(team.requiredSkills||[]).slice(0,4).map((s:string)=><span key={s} className="rounded-full bg-[#f4f1e8] px-2 py-1 text-[10px] font-semibold">{s}</span>)}{(team.requiredSkills||[]).length===0 && <span className="text-xs text-[#aaa9a2]">No skills listed</span>}</div>
              <div className="mt-4 flex gap-2">
                <button onClick={()=>join(team.id)} disabled={!!myTeam || !!actionLoading} className="flex-1 rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-40 flex items-center justify-center gap-1">{actionLoading===team.id?<Loader2 size={14} className="animate-spin"/>:<UserPlus size={14}/>} Join</button>
                <button onClick={()=>openTeamDetail(team.id)} className="rounded-xl border border-[#dedbd1] px-3 py-2 text-xs font-semibold inline-flex items-center gap-1"><Eye size={14}/> View</button>
              </div>
              {myTeam && <div className="mt-2 text-[11px] text-[#f26a4f]">Leave current team to join another.</div>}
            </motion.div>
          )) : <div className="rounded-xl border border-dashed border-[#dedbd1] p-8 text-center md:col-span-3"><Users size={20} className="mx-auto text-[#aaa9a2]"/><p className="mt-2 text-sm font-semibold">No teams match</p><p className="text-xs text-[#77798a]">Try broadening your search or create a team.</p></div>}
        </div>
      </div>

      {/* Skill matching */}
      <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
        <h3 className="font-bold flex items-center gap-2"><Sparkles size={16} className="text-[#5aafbd]"/> Skill-matched candidates</h3>
        <p className="mt-1 text-xs text-[#77798a]">Complementary skills scored by backend (uses your skill profile visibility = TEAM_DISCOVERABLE).</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {candidates.length ? candidates.slice(0,6).map((c:any,i:number)=>(
            <div key={c.userId || i} className="rounded-xl bg-[#171a2d] p-4 text-[#fdfbf5]">
              <div className="flex items-center justify-between"><span className="font-mono text-xs text-[#d8e35b]">Match {c.matchScore ?? c.score ?? '—'}</span><Heart size={14} className="text-[#f26a4f]"/></div>
              <div className="mt-2 text-sm font-bold">{c.userId?.slice(0,8) || 'Candidate'}</div>
              <div className="mt-1 text-xs text-[#b9bdca]">Languages: {(c.programmingLanguages||[]).join(', ') || '—'}</div>
              <div className="text-xs text-[#b9bdca]">Frameworks: {(c.frameworks||[]).join(', ') || '—'}</div>
              <div className="mt-2 flex flex-wrap gap-1">{(c.interests||[]).slice(0,3).map((x:string)=><span key={x} className="rounded-full bg-[#252941] px-2 py-1 text-[10px]">{x}</span>)}</div>
              <div className="mt-3 text-[11px] text-[#9b9fb1]">{c.availability || ''} · {c.experienceLevel || ''}</div>
            </div>
          )) : <div className="rounded-xl bg-[#f4f1e8] p-4 text-xs text-[#77798a] md:col-span-3">No candidates yet. Create a skill profile with visibility TEAM_DISCOVERABLE to enable matching.</div>}
        </div>
      </div>

      {/* Create modal */}
      <AnimatePresence>
        {showCreate && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-40 grid place-items-center bg-[#171a2d]/60 p-4 backdrop-blur-sm">
            <motion.form onSubmit={createTeam} initial={{y:10,opacity:0}} animate={{y:0,opacity:1}} exit={{y:10,opacity:0}} className="w-full max-w-md rounded-2xl bg-[#fdfbf5] p-6">
              <h3 className="text-lg font-bold">Create team</h3>
              <p className="mt-1 text-xs text-[#77798a]">You will become leader. Required for repo & grant.</p>
              <label className="mt-4 block text-xs font-semibold">Team name *<input value={createForm.name} onChange={e=>setCreateForm(f=>({...f,name:e.target.value}))} required placeholder="soft launch" className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm outline-none focus:border-[#f26a4f]"/></label>
              <label className="mt-3 block text-xs font-semibold">Required skills (comma separated)<input value={createForm.requiredSkills} onChange={e=>setCreateForm(f=>({...f,requiredSkills:e.target.value}))} placeholder="React, Node, Python" className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm outline-none focus:border-[#f26a4f]"/></label>
              <label className="mt-3 block text-xs font-semibold">Max members<select value={createForm.maxMembers} onChange={e=>setCreateForm(f=>({...f,maxMembers:e.target.value}))} className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm"><option>2</option><option>3</option><option>4</option><option>5</option><option>6</option></select></label>
              {!hackathonId && <label className="mt-3 block text-xs font-semibold">Hackathon ID*<input value={createForm.hackathonId} onChange={e=>setCreateForm(f=>({...f,hackathonId:e.target.value}))} placeholder="hackathon id" className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm"/></label>}
              <div className="mt-6 flex gap-2"><button type="submit" disabled={!!actionLoading} className="flex-1 rounded-xl bg-[#f26a4f] px-4 py-2 text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2">{actionLoading==='create'?<Loader2 size={16} className="animate-spin"/>:<Plus size={16}/>} Create</button><button type="button" onClick={()=>setShowCreate(false)} className="rounded-xl border border-[#dedbd1] px-4 py-2 text-sm font-bold">Cancel</button></div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Team detail modal */}
      <AnimatePresence>
        {selectedTeam && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-40 grid place-items-center bg-[#171a2d]/60 p-4 backdrop-blur-sm">
            <motion.div initial={{y:10,opacity:0}} animate={{y:0,opacity:1}} exit={{y:10,opacity:0}} className="w-full max-w-lg rounded-2xl bg-[#fdfbf5] p-6 max-h-[80vh] overflow-auto">
              {selectedTeam.loading ? <div className="flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin"/> Loading team...</div> : (
                <>
                  <div className="flex items-start justify-between"><div><h3 className="text-lg font-bold">{detailTeam?.name || selectedTeam.name}</h3><p className="text-xs text-[#77798a]">ID {String(detailTeam?.id || selectedTeam.id).slice(0,12)}</p></div><button onClick={()=>{setSelectedTeam(null); setDetailTeam(null)}} className="rounded-lg p-1 hover:bg-[#f4f1e8]"><X size={18}/></button></div>
                  <div className="mt-4 grid gap-3">
                    <div className="rounded-xl bg-[#f4f1e8] p-3 text-xs"><div className="font-bold">Visibility & discoverable</div><div className="mt-1 text-[#77798a]">{detailTeam?.visibility || 'TEAM_DISCOVERABLE'} · {detailTeam?.isDiscoverable?'Discoverable':'Private'} · {detailTeam?.members?.length||0}/{detailTeam?.maxMembers||4} members</div></div>
                    <div className="rounded-xl border border-[#e5e1d7] p-3"><div className="text-xs font-bold">Members</div><div className="mt-2 flex flex-wrap gap-2">{(detailTeam?.members||[]).map((m:any)=><span key={m.id} className="rounded-full bg-[#171a2d] px-3 py-1 text-xs font-semibold text-white">{m.user?.fullName || m.userId?.slice(0,8)} · {m.role}</span>)}{(detailTeam?.members||[]).length===0 && <span className="text-xs text-[#77798a]">Members hidden (privacy)</span>}</div></div>
                    <div className="rounded-xl border border-[#e5e1d7] p-3"><div className="text-xs font-bold">Required skills</div><div className="mt-2 flex flex-wrap gap-1.5">{(detailTeam?.requiredSkills||detailTeam?.requirements||[]).map((s:string)=><span key={s} className="rounded-full bg-[#f4f1e8] px-2 py-1 text-xs">{s}</span>)}{(detailTeam?.requiredSkills||[]).length===0 && <span className="text-xs text-[#77798a]">—</span>}</div></div>
                    {detailTeam?.project && <div className="rounded-xl bg-[#171a2d] p-3 text-[#fdfbf5] text-xs"><div className="font-bold text-[#d8e35b]">Linked project</div><div className="mt-1">{detailTeam.project.title}</div><div className="text-[#9b9fb1] line-clamp-2">{detailTeam.project.description}</div></div>}
                  </div>
                  <div className="mt-6 flex gap-2">
                    {!myTeam && detailTeam?.id && <button onClick={()=>{join(detailTeam.id); setSelectedTeam(null);}} className="flex-1 rounded-xl bg-[#171a2d] px-4 py-2 text-sm font-bold text-white">Join team</button>}
                    <button onClick={()=>{setSelectedTeam(null); setDetailTeam(null)}} className="rounded-xl border border-[#dedbd1] px-4 py-2 text-sm font-bold">Close</button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
