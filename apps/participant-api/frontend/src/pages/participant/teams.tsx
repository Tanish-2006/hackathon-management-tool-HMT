import { useEffect, useMemo, useState } from 'react';
import { Link, useSearch } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Search, Filter, Sparkles, ArrowRight, LogOut, Check, X, Mail, ShieldCheck, AlertCircle, Loader2, Plus, Compass, Heart, Target, Crown, Eye, UserPlus } from 'lucide-react';
import { hmtBackendService, ApiError } from '@/services/backendApi';
import { useHackathonContext } from '@/hooks/use-hackathon-context';

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
  // Join-with-TID form state (separate from the Create Team form above).
  const [joinName,setJoinName]=useState('');
  const [joinTid,setJoinTid]=useState('');
  // Join requests (leader-approved path): leader inbox + own outgoing.
  const [myUserId,setMyUserId]=useState<string|null>(null);
  const [reqInbox,setReqInbox]=useState<any[]>([]);
  const [myRequests,setMyRequests]=useState<any[]>([]);
  // Leave requests (member → leader approval): leader inbox + own outgoing.
  const [leaveInbox,setLeaveInbox]=useState<any[]>([]);
  const [myLeaveReqs,setMyLeaveReqs]=useState<any[]>([]);
  // Per-team request composer: teamId -> draft (message + 4 short skill answers).
  const [reqDrafts,setReqDrafts]=useState<Record<string,{message:string;skillRole:string;skillLanguages:string;skillExperience:string;skillContribution:string}>>({});
  const [reqOpenFor,setReqOpenFor]=useState<string|null>(null);
  const [transferTo,setTransferTo]=useState('');
  const [confirmDelete,setConfirmDelete]=useState(false);
  function draftFor(teamId:string){
    return reqDrafts[teamId] || { message:'', skillRole:'', skillLanguages:'', skillExperience:'', skillContribution:'' };
  }
  function setDraft(teamId:string, patch:Partial<{message:string;skillRole:string;skillLanguages:string;skillExperience:string;skillContribution:string}>){
    setReqDrafts(prev=>({ ...prev, [teamId]: { ...draftFor(teamId), ...patch } }));
  }
  async function refreshOutgoing(){
    try{
      const r:any = await hmtBackendService.getMyJoinRequests();
      const arr = Array.isArray(r) ? r : (r?.data ?? []);
      setMyRequests(arr.filter((x:any)=>!contextId || String(x.hackathonId)===String(contextId)));
    }catch{ /* keep last state */ }
    try{
      const l:any = await hmtBackendService.getMyLeaveRequests();
      const larr = Array.isArray(l) ? l : (l?.data ?? []);
      setMyLeaveReqs(larr.filter((x:any)=>!contextId || String(x.hackathonId)===String(contextId)));
    }catch{ /* keep last state */ }
  }

  // hackathon id for create
  const [hackathonId,setHackathonId]=useState<string>('');

  // Hackathon-scoped context: a team belongs to exactly one hackathon.
  // The context resolves to a registered hackathon (persisted selection when
  // still valid) so another hackathon's team is never shown here.
  const ctx = useHackathonContext();
  const contextId = ctx.selectedId;

  // Deep-link support from registration team-choice (?view=create|join).
  const viewParam = new URLSearchParams(useSearch()).get('view');
  useEffect(()=>{
    if(viewParam==='create' && contextId && ctx.selectedIsRegistered) setShowCreate(true);
    if(viewParam==='join' && contextId) {
      // Let the list render first, then bring the TID panel into view.
      const t = setTimeout(()=>{ document.getElementById('join-by-code')?.scrollIntoView({ behavior:'smooth', block:'center' }); }, 400);
      return ()=>clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[contextId]);

  useEffect(()=>{
    // Clear stale team state immediately on context switch — never flash the
    // previous hackathon's team as if it belonged to the new one.
    setMyTeam(null); setDiscover([]); setCandidates([]);
    if(ctx.loading || !contextId) { setLoading(!ctx.loading); return; }
    setHackathonId(contextId);
    let m=true;
    async function load(){
      setLoading(true); setError(null);
      try{
        const [teamRes, discRes, candRes, invRes, meRes, outReqRes, outLeaveRes] = await Promise.allSettled([
          hmtBackendService.getMyTeam(contextId),
          hmtBackendService.discoverTeams({ hackathonId: contextId }),
          hmtBackendService.getMatchCandidates(contextId),
          hmtBackendService.getMyInvitations(),
          hmtBackendService.getMe().catch(()=>null),
          hmtBackendService.getMyJoinRequests().catch(()=>({data:[]})),
          hmtBackendService.getMyLeaveRequests().catch(()=>({data:[]})),
        ]);
        if(!m) return;
        if(teamRes.status==='fulfilled'){
          const raw = teamRes.value as any;
          const t = raw?.team ?? raw;
          // Accept only the context hackathon's team (stale guard); the
          // scoped backend already filters, this covers legacy shapes.
          if(t && t.id && (!t.hackathonId || String(t.hackathonId)===String(contextId))) setMyTeam(t);
          else setMyTeam(null);
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
        if(meRes.status==='fulfilled'){
          const u:any = (meRes.value as any)?.user ?? meRes.value;
          if(u?.id) setMyUserId(String(u.id));
        }
        if(outReqRes.status==='fulfilled'){
          const o:any = outReqRes.value;
          const arr = Array.isArray(o) ? o : (o?.data ?? []);
          setMyRequests(arr.filter((r:any)=>!contextId || String(r.hackathonId)===String(contextId)));
        }
        if(outLeaveRes.status==='fulfilled'){
          const o:any = outLeaveRes.value;
          const arr = Array.isArray(o) ? o : (o?.data ?? []);
          setMyLeaveReqs(arr.filter((r:any)=>!contextId || String(r.hackathonId)===String(contextId)));
        }
        // Leader inboxes (join + leave): only leaders can read them — 403 hides the sections.
        {
          const raw = teamRes.status==='fulfilled' ? (teamRes.value as any) : null;
          const t = raw?.team ?? raw;
          if(t?.id){
            hmtBackendService.getTeamJoinRequests(t.id)
              .then((r:any)=>{ if(m) setReqInbox(Array.isArray(r) ? r : (r?.data ?? [])); })
              .catch(()=>{ if(m) setReqInbox([]); });
            hmtBackendService.getTeamLeaveRequests(t.id)
              .then((r:any)=>{ if(m) setLeaveInbox(Array.isArray(r) ? r : (r?.data ?? [])); })
              .catch(()=>{ if(m) setLeaveInbox([]); });
          } else if(m) { setReqInbox([]); setLeaveInbox([]); }
        }
      }catch(e){ if(m) setError(friendly(e)); }
      finally{ if(m) setLoading(false); }
    }
    load(); return ()=>{m=false}
  },[ctx.loading, contextId]);

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

  async function refreshScopedTeam(){
    if(!contextId) { setMyTeam(null); return; }
    try{
      const t = await hmtBackendService.getMyTeam(contextId);
      const team = (t as any)?.team ?? t;
      setMyTeam(team?.id && (!team.hackathonId || String(team.hackathonId)===String(contextId)) ? team : null);
    }catch{ /* keep current state on refresh failure */ }
  }
  // Join is request-only: the backend persists a PENDING request and notifies
  // the leader. Membership is created ONLY on leader acceptance.
  async function join(teamId:string){
    setActionLoading(teamId); setError(null); setSuccess(null);
    try{ await hmtBackendService.joinTeam(teamId); setSuccess('Request sent — the team leader will review it. Check the bell for updates.'); await refreshOutgoing(); }catch(e){ setError(friendly(e)); }
    finally{ setActionLoading(null); }
  }
  // Join with team name + TID (no invitation needed — the TID is the
  // capability). Still approval-based: PENDING request + leader notification.
  // Scoped to the selected hackathon; the backend verifies registration,
  // scope, capacity, and duplicates.
  async function joinByCode(e: React.FormEvent){
    e.preventDefault(); setActionLoading('by-code'); setError(null); setSuccess(null);
    try{
      if(!contextId) throw new Error('Select a hackathon context first');
      if(!joinName.trim() || !joinTid.trim()) throw new Error('Enter the team name and TID.');
      await hmtBackendService.joinByCode({ teamName: joinName.trim(), tid: joinTid.trim(), hackathonId: contextId });
      setSuccess(`You joined "${joinName.trim()}".`); setJoinName(''); setJoinTid('');
      await refreshScopedTeam();
    }catch(e){ setError(friendly(e)); }
    finally{ setActionLoading(null); }
  }
  async function copyTid(tid: string){
    try { await navigator.clipboard.writeText(tid); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = tid; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* clipboard unavailable */ }
      document.body.removeChild(ta);
    }
    setSuccess(`TID ${tid} copied — share it with teammates`);
  }
  // Leaving needs leader approval for members: the backend persists a PENDING
  // leave request and notifies the leader. You stay a member until accepted.
  async function leave(){
    setActionLoading('leave'); setError(null); setSuccess(null);
    try{
      const r:any = await hmtBackendService.leaveTeam(contextId ?? undefined, myTeam?.id);
      if(r?.status === 'PENDING'){ setSuccess('Leave request sent — the team leader will review it. You are still a member until accepted.'); await refreshOutgoing(); }
      else { setMyTeam(null); setSuccess('Left team'); }
    }catch(e){ setError(friendly(e)); }
    finally{ setActionLoading(null); }
  }
  async function submitLeave(){
    if(!visibleTeam?.id) return;
    setActionLoading('leave-req'); setError(null); setSuccess(null);
    try{
      await hmtBackendService.requestToLeaveTeam(visibleTeam.id);
      setSuccess('Leave request sent — the team leader will review it. You are still a member until accepted.');
      await refreshOutgoing();
    }catch(e){ setError(friendly(e)); }
    finally{ setActionLoading(null); }
  }
  async function cancelLeave(requestId:string){
    setActionLoading(requestId); setError(null); setSuccess(null);
    try{
      await hmtBackendService.cancelLeaveRequest(requestId);
      setSuccess('Leave request cancelled — you are still a member.');
      await refreshOutgoing();
    }catch(e){ setError(friendly(e)); }
    finally{ setActionLoading(null); }
  }
  async function decideLeave(requestId:string, accept:boolean){
    setActionLoading(requestId); setError(null); setSuccess(null);
    try{
      if(accept) await hmtBackendService.acceptLeaveRequest(requestId);
      else await hmtBackendService.rejectLeaveRequest(requestId);
      setSuccess(accept ? 'Member removed from the team.' : 'Leave request rejected — the member stays.');
      await refreshLeaveInbox(); await refreshScopedTeam(); await refreshOutgoing();
    }catch(e){ setError(friendly(e)); }
    finally{ setActionLoading(null); }
  }
  async function acceptInvite(id:string){
    setActionLoading(id); setError(null);
    try{ await hmtBackendService.acceptInvitation(id); setSuccess('Invitation accepted'); await refreshScopedTeam(); const inv = await hmtBackendService.getMyInvitations(); setInvites(Array.isArray(inv)?inv: (inv as any)?.data||[]); }catch(e){ setError(friendly(e)); }
    finally{ setActionLoading(null); }
  }
  async function declineInvite(id:string){
    setActionLoading(id); try{ await hmtBackendService.declineInvitation(id); setInvites(prev=> prev.filter(i=>i.id!==id)); setSuccess('Invitation declined'); }catch(e){ setError(friendly(e)); } finally{ setActionLoading(null); }
  }
  async function refreshInbox(){
    const tid = (visibleTeam as any)?.id;
    if(!tid){ setReqInbox([]); return; }
    try{
      const r:any = await hmtBackendService.getTeamJoinRequests(tid);
      setReqInbox(Array.isArray(r) ? r : (r?.data ?? []));
    }catch{ setReqInbox([]); }
  }
  async function refreshLeaveInbox(){
    const tid = (visibleTeam as any)?.id;
    if(!tid){ setLeaveInbox([]); return; }
    try{
      const r:any = await hmtBackendService.getTeamLeaveRequests(tid);
      setLeaveInbox(Array.isArray(r) ? r : (r?.data ?? []));
    }catch{ setLeaveInbox([]); }
  }
  async function submitRequest(teamId:string){
    setActionLoading(`req-${teamId}`); setError(null); setSuccess(null);
    try{
      const d = draftFor(teamId);
      await hmtBackendService.requestToJoinTeam(teamId, {
        message: d.message.trim() || undefined,
        skillRole: d.skillRole.trim() || undefined,
        skillLanguages: d.skillLanguages.trim() || undefined,
        skillExperience: d.skillExperience.trim() || undefined,
        skillContribution: d.skillContribution.trim() || undefined,
      });
      setReqDrafts(prev=>{ const n={...prev}; delete n[teamId]; return n; });
      setReqOpenFor(null);
      setSuccess('Join request sent — the team leader will review it.');
      await refreshOutgoing();
    }catch(e){ setError(friendly(e)); }
    finally{ setActionLoading(null); }
  }
  async function decideRequest(requestId:string, accept:boolean){
    setActionLoading(requestId); setError(null); setSuccess(null);
    try{
      if(accept) await hmtBackendService.acceptJoinRequest(requestId);
      else await hmtBackendService.rejectJoinRequest(requestId);
      setSuccess(accept ? 'Member added to the team.' : 'Request rejected.');
      await refreshInbox(); await refreshScopedTeam(); await refreshOutgoing();
    }catch(e){ setError(friendly(e)); }
    finally{ setActionLoading(null); }
  }
  async function transfer(){
    if(!visibleTeam?.id || !transferTo) return;
    setActionLoading('transfer'); setError(null); setSuccess(null);
    try{
      await hmtBackendService.transferLeadership(visibleTeam.id, transferTo);
      setSuccess('Leadership transferred.');
      setTransferTo('');
      await refreshScopedTeam(); await refreshInbox(); await refreshLeaveInbox();
    }catch(e){ setError(friendly(e)); }
    finally{ setActionLoading(null); }
  }
  async function removeTeam(){
    if(!visibleTeam?.id) return;
    setActionLoading('delete'); setError(null); setSuccess(null);
    try{
      await hmtBackendService.deleteTeam(visibleTeam.id);
      setConfirmDelete(false);
      setSuccess('Team deleted.');
      setMyTeam(null); setReqInbox([]); setLeaveInbox([]);
      await refreshOutgoing();
    }catch(e){ setError(friendly(e)); }
    finally{ setActionLoading(null); }
  }
  async function createTeam(e: React.FormEvent){
    e.preventDefault(); setActionLoading('create'); setError(null);
    try{
      const payload:any = { name: createForm.name, hackathonId: contextId || hackathonId || createForm.hackathonId, requiredSkills: createForm.requiredSkills.split(',').map(s=>s.trim()).filter(Boolean), maxMembers: Number(createForm.maxMembers)||4 };
      if(!payload.hackathonId) throw new Error('Register for a hackathon first — team formation unlocks after registration');
      const created:any = await hmtBackendService.createTeam(payload);
      setMyTeam(created);
      const tid = created?.inviteCode ? ` — TID ${created.inviteCode} (share it so teammates can join)` : '';
      setSuccess(`Team "${payload.name}" created — you are leader${tid}`); setShowCreate(false);
    }catch(e){ setError(friendly(e)); } finally{ setActionLoading(null); }
  }
  async function openTeamDetail(id:string){
    setSelectedTeam({ id, loading:true });
    try{ const t = await hmtBackendService.getTeamById(id); setDetailTeam(t); setSelectedTeam(t); }catch(e){ setError(friendly(e)); setSelectedTeam(null); }
  }

  // Render-time stale guard: never display another hackathon's team here,
  // even for a frame while the scoped reload is in flight.
  const visibleTeam = myTeam?.id && (!myTeam.hackathonId || !contextId || String(myTeam.hackathonId)===String(contextId)) ? myTeam : null;
  const contextRegistered = !!contextId && ctx.selectedIsRegistered;
  const isLeader = !!(visibleTeam?.members?.length && myUserId && visibleTeam.members.some((m:any)=>String(m.userId)===String(myUserId) && m.role==='LEADER'));
  // Leader inbox follows the visible team (403 for non-leaders hides it).
  // NOTE: this effect must stay above the loading early-return — a hook
  // after a conditional return changes the hook count between renders
  // and crashes React ("rendered more hooks than during the previous render").
  useEffect(()=>{
    if(isLeader && visibleTeam?.id) { refreshInbox(); refreshLeaveInbox(); }
    else { setReqInbox([]); setLeaveInbox([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[visibleTeam?.id, myUserId]);

  if(loading) return <div className="space-y-4"><div className="h-24 animate-pulse rounded-2xl bg-[#e9e5da]"/><div className="grid gap-4 lg:grid-cols-3"><div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/><div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/><div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/></div></div>

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">Teams · Discover & match</div>
          <h1 className="mt-2 text-3xl font-bold tracking-[-.05em] text-[#171a2d]">Find your crew.</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#77798a]">Teams belong to one hackathon. Discover teams, match by complementary skills, handle invitations, join or leave — all permission-aware.</p>
        </div>
        <button onClick={()=>setShowCreate(true)} disabled={!contextId || !ctx.selectedIsRegistered} title={!contextId ? 'Register for a hackathon first' : !ctx.selectedIsRegistered ? 'Register for this hackathon first' : 'Create team'} className="inline-flex items-center gap-2 rounded-xl bg-[#171a2d] px-4 py-3 text-sm font-bold text-white disabled:opacity-40"><Plus size={16}/> Create team</button>
      </div>

      {/* Hackathon context: team membership is per-hackathon, never global */}
      <div className="rounded-2xl border border-[#dedbd1] bg-[#f4f1e8] px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {ctx.loading ? (
          <span className="text-xs text-[#77798a]">Loading hackathon context…</span>
        ) : !contextId ? (
          <span className="text-xs text-[#55586a]">You have not registered for a hackathon yet — team formation unlocks after registration. <Link href="/participant/hackathons" className="font-bold underline">Discover hackathons</Link> or <Link href="/participant/my-hackathons" className="font-bold underline">open My Hackathons</Link>.</span>
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
              <span className="text-xs text-[#55586a]">Not registered here — <Link href="/participant/hackathons" className="font-bold underline">register in Discover</Link> to unlock team formation.</span>
            )}
          </>
        )}
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2"><AlertCircle size={16} className="mt-0.5"/>{error}<button onClick={()=>setError(null)} className="ml-auto"><X size={14}/></button></div>}
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 flex items-start gap-2"><Check size={16} className="mt-0.5"/>{success}<button onClick={()=>setSuccess(null)} className="ml-auto"><X size={14}/></button></div>}

      {/* My team (scoped to the selected hackathon) */}
      <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
        <div className="flex items-center justify-between"><h2 className="font-bold flex items-center gap-2"><Users size={16} className="text-[#f26a4f]"/> My team{ctx.selectedTitle ? <span className="font-mono text-[11px] font-normal text-[#77798a]">· {ctx.selectedTitle}</span> : null}</h2>{visibleTeam ? <Badge tone="lime">IN TEAM</Badge> : <Badge tone="muted">NO TEAM</Badge>}</div>
        {visibleTeam?.id ? (
          <div className="mt-4 grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
            <div>
              <div className="text-xl font-bold">{visibleTeam.name}</div>
              {visibleTeam.inviteCode && (
                <button onClick={()=>copyTid(String(visibleTeam.inviteCode))} title="Copy TID" className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-[#171a2d] px-2.5 py-1 font-mono text-[11px] font-bold text-[#d8e35b] hover:bg-[#252941]">
                  TID: {visibleTeam.inviteCode} <span className="font-sans font-semibold text-[#9b9fb1]">⧉ copy</span>
                </button>
              )}
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-[#77798a]"><span>{visibleTeam.members?.length || 1} members</span><span>· {visibleTeam.visibility}</span><span>· {visibleTeam.isDiscoverable ? 'Discoverable' : 'Private'}</span></div>
              <div className="mt-3 flex flex-wrap gap-1.5">{(visibleTeam.requiredSkills||[]).map((s:string)=><span key={s} className="rounded-full bg-[#f4f1e8] px-2 py-1 text-[11px] font-semibold">{s}</span>)}</div>
              <div className="mt-4 flex -space-x-2">
                {(visibleTeam.members||[]).map((m:any,i:number)=>(<span key={m.id||i} className="grid h-9 w-9 place-items-center rounded-full border-2 border-white bg-[#5aafbd] text-xs font-bold text-[#171a2d]">{(m.user?.fullName || m.userId || '?').slice(0,2).toUpperCase()}</span>))}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {isLeader ? (
                  <span className="rounded-xl bg-[#f4f1e8] px-4 py-2 text-xs font-semibold text-[#77798a]">You lead this team — transfer leadership below to leave.</span>
                ) : myLeaveReqs.some((r:any)=>r.status==='PENDING' && String(r.teamId)===String(visibleTeam.id)) ? (
                  <span className="rounded-xl bg-[#fff7ea] border border-[#f26a4f]/40 px-4 py-2 text-xs font-bold text-[#f26a4f]">Leave request pending — leader review</span>
                ) : (
                  <button onClick={leave} disabled={!!actionLoading} title="Leaving needs leader approval — you stay a member until accepted" className="rounded-xl border border-[#dedbd1] px-4 py-2 text-xs font-bold flex items-center gap-2 disabled:opacity-50">{actionLoading==='leave'?<Loader2 size={14} className="animate-spin"/>:<LogOut size={14}/>} Request to leave</button>
                )}
                <Link href="/participant/projects" className="rounded-xl bg-[#f26a4f] px-4 py-2 text-xs font-bold text-white">Go to project</Link>
              </div>
            </div>
            <div className="rounded-xl bg-[#f4f1e8] p-4">
              <div className="text-xs font-bold flex items-center gap-2"><Crown size={14}/> Team details</div>
              <div className="mt-2 text-xs text-[#77798a]">Your team is linked to hackathon <b className="text-[#171a2d]">{ctx.selectedTitle || visibleTeam.hackathonId?.slice(0,8) || hackathonId.slice(0,8) || '—'}</b></div>
              <div className="mt-3 text-xs leading-5 text-[#77798a]">Leaving frees you to join another team in this hackathon. Only the leader can connect a repository and grant AI access.</div>
              <div className="mt-3 flex gap-2">
                <button onClick={()=> visibleTeam.id && openTeamDetail(visibleTeam.id)} className="rounded-lg border border-[#dedbd1] bg-white px-3 py-1.5 text-xs font-semibold">View details</button>
              </div>
              {isLeader && (
                <div className="mt-4 space-y-3 border-t border-[#e5e1d7] pt-4">
                  <div>
                    <div className="text-xs font-bold">Transfer leadership</div>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <select value={transferTo} onChange={e=>setTransferTo(e.target.value)} className="flex-1 rounded-xl border border-[#dedbd1] bg-white px-3 py-2 text-xs outline-none">
                        <option value="">Select a member…</option>
                        {(visibleTeam.members||[]).filter((m:any)=>m.role!=='LEADER').map((m:any)=><option key={m.userId || m.id} value={m.userId}>{m.user?.fullName || String(m.userId).slice(0,8)} · {m.role}</option>)}
                      </select>
                      <button onClick={transfer} disabled={!transferTo || !!actionLoading} className="rounded-xl border border-[#dedbd1] px-3 py-2 text-xs font-bold disabled:opacity-50">Transfer</button>
                    </div>
                    <p className="mt-1 text-[11px] text-[#77798a]">Exactly one leader — you become a member. Locked after registration closes.</p>
                  </div>
                  <div>
                    {!confirmDelete ? (
                      <button onClick={()=>setConfirmDelete(true)} className="rounded-xl border border-red-200 px-3 py-2 text-xs font-bold text-[#d74635]">Delete team</button>
                    ) : (
                      <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                        <div className="text-xs font-bold text-red-700">Delete “{visibleTeam.name}”?</div>
                        <p className="mt-1 text-[11px] leading-5 text-red-600">Members are removed and pending requests cancelled. Teams with a project cannot be deleted. This cannot be undone.</p>
                        <div className="mt-2 flex gap-2">
                          <button onClick={removeTeam} disabled={!!actionLoading} className="rounded-xl bg-[#d74635] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{actionLoading==='delete'?'Deleting…':'Confirm delete'}</button>
                          <button onClick={()=>setConfirmDelete(false)} className="rounded-xl border border-[#dedbd1] bg-white px-3 py-2 text-xs font-semibold">Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-3">
            {!contextRegistered ? (
              <>
                <p className="text-sm leading-6 text-[#77798a]">Team formation unlocks after you register for this hackathon.</p>
                <div className="mt-4 flex gap-2">
                  <Link href="/participant/hackathons" className="rounded-xl bg-[#f26a4f] px-4 py-2 text-xs font-bold text-white">Discover & register</Link>
                  <Link href="/participant/my-hackathons" className="rounded-xl border border-[#dedbd1] px-4 py-2 text-xs font-bold">My Hackathons</Link>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm leading-6 text-[#77798a]">You are not in a team for {ctx.selectedTitle || 'this hackathon'} yet. Browse below, get skill-matched, or create your own team (you become leader).</p>
                <div className="mt-4 flex gap-2">
                  <button onClick={()=>setShowCreate(true)} className="rounded-xl bg-[#f26a4f] px-4 py-2 text-xs font-bold text-white">Create team</button>
                  <a href="#discover" className="rounded-xl border border-[#dedbd1] px-4 py-2 text-xs font-bold">Discover teams</a>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Request with team name + TID (leader approval required) */}
      <div id="join-by-code" className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
        <h3 className="font-bold flex items-center gap-2"><UserPlus size={16} className="text-[#5aafbd]"/> Request with team name + TID</h3>
        {!contextRegistered ? (
          <p className="mt-2 text-xs leading-5 text-[#77798a]">Register for {ctx.selectedTitle || 'this hackathon'} first — then enter the team name and TID shared by the team leader.</p>
        ) : visibleTeam?.id ? (
          <p className="mt-2 text-xs leading-5 text-[#77798a]">You are already in a team for {ctx.selectedTitle || 'this hackathon'}. Leave it first to join another.</p>
        ) : (
          <form onSubmit={joinByCode} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input value={joinName} onChange={e=>setJoinName(e.target.value)} placeholder="Team name (e.g. Innovators)" maxLength={120} className="flex-1 rounded-xl border border-[#dedbd1] bg-white px-3 py-2 text-sm outline-none focus:border-[#f26a4f]"/>
            <input value={joinTid} onChange={e=>setJoinTid(e.target.value.toUpperCase())} placeholder="TID (e.g. HMT-A7K9Q2)" maxLength={16} className="w-full rounded-xl border border-[#dedbd1] bg-white px-3 py-2 font-mono text-sm outline-none focus:border-[#f26a4f] sm:w-52"/>
            <button type="submit" disabled={!!actionLoading} className="rounded-xl bg-[#171a2d] px-4 py-2 text-xs font-bold text-white disabled:opacity-50 inline-flex items-center justify-center gap-1">{actionLoading==='by-code'?<Loader2 size={14} className="animate-spin"/>:<UserPlus size={14}/>} Send join request</button>
          </form>
        )}
      </div>

      {/* Join requests — leader inbox (skill answers visible to leader only) */}
      {isLeader && (
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
          <h3 className="font-bold flex items-center gap-2"><UserPlus size={16} className="text-[#f26a4f]"/> Join requests <Badge tone={reqInbox.length?'coral':'muted'}>{reqInbox.length} pending</Badge></h3>
          {reqInbox.length ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {reqInbox.map((r:any)=>(
                <div key={r.id} className="rounded-xl border border-[#e5e1d7] bg-white p-4">
                  <div className="text-sm font-bold">{r.applicant?.fullName || String(r.userId).slice(0,8)}</div>
                  {r.message && <p className="mt-1 text-xs text-[#55586a]">“{r.message}”</p>}
                  {(r.skillAnswers?.role || r.skillAnswers?.languages || r.skillAnswers?.experience || r.skillAnswers?.contribution) && (
                    <div className="mt-2 rounded-xl bg-[#f4f1e8] p-3 text-[11px] leading-5 text-[#55586a]">
                      {r.skillAnswers.role && <div><b>Role:</b> {r.skillAnswers.role}</div>}
                      {r.skillAnswers.languages && <div><b>Languages/tools:</b> {r.skillAnswers.languages}</div>}
                      {r.skillAnswers.experience && <div><b>Experience:</b> {r.skillAnswers.experience}</div>}
                      {r.skillAnswers.contribution && <div><b>Contribution:</b> {r.skillAnswers.contribution}</div>}
                    </div>
                  )}
                  <div className="mt-3 flex gap-2">
                    <button onClick={()=>decideRequest(r.id,true)} disabled={!!actionLoading} className="flex-1 rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{actionLoading===r.id?'Working…':'Accept'}</button>
                    <button onClick={()=>decideRequest(r.id,false)} disabled={!!actionLoading} className="rounded-xl border border-[#dedbd1] px-3 py-2 text-xs font-semibold disabled:opacity-50">Reject</button>
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="mt-3 rounded-xl bg-[#f4f1e8] p-4 text-xs text-[#77798a]">No pending join requests.</div>}
        </div>
      )}

      {/* Leave requests — leader inbox */}
      {isLeader && (
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
          <h3 className="font-bold flex items-center gap-2"><LogOut size={16} className="text-[#f26a4f]"/> Leave requests <Badge tone={leaveInbox.length?'coral':'muted'}>{leaveInbox.length} pending</Badge></h3>
          {leaveInbox.length ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {leaveInbox.map((r:any)=>(
                <div key={r.id} className="rounded-xl border border-[#e5e1d7] bg-white p-4">
                  <div className="text-sm font-bold">{r.member?.fullName || String(r.userId).slice(0,8)}</div>
                  <p className="mt-1 text-xs text-[#55586a]">Wants to leave the team. Membership stays until you accept.</p>
                  <div className="mt-3 flex gap-2">
                    <button onClick={()=>decideLeave(r.id,true)} disabled={!!actionLoading} className="flex-1 rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{actionLoading===r.id?'Working…':'Accept & remove'}</button>
                    <button onClick={()=>decideLeave(r.id,false)} disabled={!!actionLoading} className="rounded-xl border border-[#dedbd1] px-3 py-2 text-xs font-semibold disabled:opacity-50">Reject</button>
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="mt-3 rounded-xl bg-[#f4f1e8] p-4 text-xs text-[#77798a]">No pending leave requests.</div>}
        </div>
      )}

      {/* My outgoing join requests */}
      {myRequests.length > 0 && (
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
          <h3 className="font-bold flex items-center gap-2"><Mail size={16}/> My join requests</h3>
          <div className="mt-3 space-y-2">
            {myRequests.map((r:any)=>(
              <div key={r.id} className="flex items-center justify-between rounded-xl border border-[#e5e1d7] px-3 py-2 text-xs">
                <span className="font-semibold">Team {String(r.teamId).slice(0,8)}</span>
                <Badge tone={r.status==='PENDING'?'coral':r.status==='APPROVED'?'lime':'muted'}>{r.status}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* My outgoing leave requests */}
      {myLeaveReqs.length > 0 && (
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
          <h3 className="font-bold flex items-center gap-2"><LogOut size={16}/> My leave requests</h3>
          <div className="mt-3 space-y-2">
            {myLeaveReqs.map((r:any)=>(
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-[#e5e1d7] px-3 py-2 text-xs">
                <span className="font-semibold">Team {String(r.teamId).slice(0,8)}</span>
                <span className="flex items-center gap-2">
                  <Badge tone={r.status==='PENDING'?'coral':r.status==='APPROVED'?'lime':'muted'}>{r.status}</Badge>
                  {r.status==='PENDING' && <button onClick={()=>cancelLeave(r.id)} disabled={!!actionLoading} className="rounded-lg border border-[#dedbd1] px-2 py-1 text-[11px] font-semibold disabled:opacity-50">Cancel</button>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

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
          {!contextRegistered ? (
            <div className="rounded-xl border border-dashed border-[#dedbd1] p-8 text-center md:col-span-3">
              <Users size={20} className="mx-auto text-[#aaa9a2]"/>
              <p className="mt-2 text-sm font-semibold">Team discovery unlocks after registration</p>
              <p className="text-xs text-[#77798a]">Register for {ctx.selectedTitle || 'a hackathon'} to browse and join its teams.</p>
            </div>
          ) : filteredDiscover.length ? filteredDiscover.map((team:any)=>(
            <motion.div key={team.id} layout initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="rounded-2xl border border-[#e5e1d7] p-4 bg-white hover:border-[#f26a4f]/50 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div><div className="text-sm font-bold leading-tight">{team.name}</div><div className="mt-1 text-[11px] text-[#77798a]">{team.members?.length||0}/{team.maxMembers||4} members · {team.visibility}</div></div>
                <Badge tone={team.isDiscoverable?'lime':'muted'}>{team.isDiscoverable?'OPEN':'CLOSED'}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">{(team.requiredSkills||[]).slice(0,4).map((s:string)=><span key={s} className="rounded-full bg-[#f4f1e8] px-2 py-1 text-[10px] font-semibold">{s}</span>)}{(team.requiredSkills||[]).length===0 && <span className="text-xs text-[#aaa9a2]">No skills listed</span>}</div>
              <div className="mt-4 flex gap-2">
                <button onClick={()=>join(team.id)} disabled={!!visibleTeam || !!actionLoading} title="Sends a request — the leader must approve before you join" className="flex-1 rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-40 flex items-center justify-center gap-1">{actionLoading===team.id?<Loader2 size={14} className="animate-spin"/>:<UserPlus size={14}/>} Request to Join</button>
                <button onClick={()=>openTeamDetail(team.id)} className="rounded-xl border border-[#dedbd1] px-3 py-2 text-xs font-semibold inline-flex items-center gap-1"><Eye size={14}/> View</button>
              </div>
              {!visibleTeam && (
                <button onClick={()=>setReqOpenFor(reqOpenFor===team.id?null:team.id)} className="mt-2 w-full text-[11px] font-semibold text-[#5aafbd] underline">or request to join (leader approves)</button>
              )}
              {reqOpenFor===team.id && !visibleTeam && (
                <div className="mt-2 space-y-2 rounded-xl bg-[#f4f1e8] p-3">
                  <input value={draftFor(team.id).message} onChange={e=>setDraft(team.id,{message:e.target.value})} placeholder="Message to the leader (optional)" maxLength={500} className="w-full rounded-lg border border-[#dedbd1] bg-white px-2.5 py-1.5 text-xs outline-none"/>
                  <div className="grid grid-cols-2 gap-2">
                    <input value={draftFor(team.id).skillRole} onChange={e=>setDraft(team.id,{skillRole:e.target.value})} placeholder="Role: frontend, AI/ML…" maxLength={300} className="rounded-lg border border-[#dedbd1] bg-white px-2.5 py-1.5 text-xs outline-none"/>
                    <input value={draftFor(team.id).skillLanguages} onChange={e=>setDraft(team.id,{skillLanguages:e.target.value})} placeholder="Languages/tools" maxLength={300} className="rounded-lg border border-[#dedbd1] bg-white px-2.5 py-1.5 text-xs outline-none"/>
                    <input value={draftFor(team.id).skillExperience} onChange={e=>setDraft(team.id,{skillExperience:e.target.value})} placeholder="Strongest skill" maxLength={300} className="rounded-lg border border-[#dedbd1] bg-white px-2.5 py-1.5 text-xs outline-none"/>
                    <input value={draftFor(team.id).skillContribution} onChange={e=>setDraft(team.id,{skillContribution:e.target.value})} placeholder="What you contribute" maxLength={300} className="rounded-lg border border-[#dedbd1] bg-white px-2.5 py-1.5 text-xs outline-none"/>
                  </div>
                  <p className="text-[10px] leading-4 text-[#77798a]">Answers go only to the team leader. No GitHub account needed to request.</p>
                  <button onClick={()=>submitRequest(team.id)} disabled={!!actionLoading} className="w-full rounded-xl bg-[#5aafbd] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{actionLoading===`req-${team.id}`?'Sending…':'Send join request'}</button>
                </div>
              )}
              {visibleTeam && <div className="mt-2 text-[11px] text-[#f26a4f]">Leave current team to join another in this hackathon.</div>}
            </motion.div>
          )) : <div className="rounded-xl border border-dashed border-[#dedbd1] p-8 text-center md:col-span-3"><Users size={20} className="mx-auto text-[#aaa9a2]"/><p className="mt-2 text-sm font-semibold">No teams match</p><p className="text-xs text-[#77798a]">Try broadening your search or create a team.</p></div>}
        </div>
      </div>

      {/* Skill matching */}
      <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
        <h3 className="font-bold flex items-center gap-2"><Sparkles size={16} className="text-[#5aafbd]"/> Skill-matched candidates</h3>
        <p className="mt-1 text-xs text-[#77798a]">Complementary skills scored by backend (uses your skill profile visibility = TEAM_DISCOVERABLE).</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {!contextRegistered ? (
            <div className="rounded-xl bg-[#f4f1e8] p-4 text-xs text-[#77798a] md:col-span-3">Skill matching unlocks after registration — matches are scored against this hackathon's teams.</div>
          ) : candidates.length ? candidates.slice(0,6).map((c:any,i:number)=>(
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
                  <div className="flex items-start justify-between"><div><h3 className="text-lg font-bold">{detailTeam?.name || selectedTeam.name}</h3><p className="text-xs text-[#77798a]">ID {String(detailTeam?.id || selectedTeam.id).slice(0,12)}{detailTeam?.inviteCode ? <span> · <button onClick={()=>copyTid(String(detailTeam.inviteCode))} title="Copy TID" className="font-mono font-bold text-[#171a2d] underline">TID: {detailTeam.inviteCode} ⧉</button></span> : null}</p></div><button onClick={()=>{setSelectedTeam(null); setDetailTeam(null)}} className="rounded-lg p-1 hover:bg-[#f4f1e8]"><X size={18}/></button></div>
                  <div className="mt-4 grid gap-3">
                    <div className="rounded-xl bg-[#f4f1e8] p-3 text-xs"><div className="font-bold">Visibility & discoverable</div><div className="mt-1 text-[#77798a]">{detailTeam?.visibility || 'TEAM_DISCOVERABLE'} · {detailTeam?.isDiscoverable?'Discoverable':'Private'} · {detailTeam?.members?.length||0}/{detailTeam?.maxMembers||4} members</div></div>
                    <div className="rounded-xl border border-[#e5e1d7] p-3"><div className="text-xs font-bold">Members</div><div className="mt-2 flex flex-wrap gap-2">{(detailTeam?.members||[]).map((m:any)=><span key={m.id} className="rounded-full bg-[#171a2d] px-3 py-1 text-xs font-semibold text-white">{m.user?.fullName || m.userId?.slice(0,8)} · {m.role}</span>)}{(detailTeam?.members||[]).length===0 && <span className="text-xs text-[#77798a]">Members hidden (privacy)</span>}</div></div>
                    <div className="rounded-xl border border-[#e5e1d7] p-3"><div className="text-xs font-bold">Required skills</div><div className="mt-2 flex flex-wrap gap-1.5">{(detailTeam?.requiredSkills||detailTeam?.requirements||[]).map((s:string)=><span key={s} className="rounded-full bg-[#f4f1e8] px-2 py-1 text-xs">{s}</span>)}{(detailTeam?.requiredSkills||[]).length===0 && <span className="text-xs text-[#77798a]">—</span>}</div></div>
                    {detailTeam?.project && <div className="rounded-xl bg-[#171a2d] p-3 text-[#fdfbf5] text-xs"><div className="font-bold text-[#d8e35b]">Linked project</div><div className="mt-1">{detailTeam.project.title}</div><div className="text-[#9b9fb1] line-clamp-2">{detailTeam.project.description}</div></div>}
                  </div>
                  <div className="mt-6 flex gap-2">
                    {!visibleTeam && detailTeam?.id && <button onClick={()=>{join(detailTeam.id); setSelectedTeam(null);}} className="flex-1 rounded-xl bg-[#171a2d] px-4 py-2 text-sm font-bold text-white">Join team</button>}
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
