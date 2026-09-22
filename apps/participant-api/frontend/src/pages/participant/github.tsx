import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Github, Lock, Unlock, ShieldCheck, ExternalLink, Loader2, AlertCircle, Check, X, GitBranch, KeyRound, EyeOff, RefreshCw, Link2 } from 'lucide-react';
import { hmtBackendService, ApiError } from '@/services/backendApi';
import { Link } from 'wouter';

function friendly(e:unknown){ return e instanceof ApiError? e.message : (e as Error)?.message || 'Failed' }

export default function ParticipantGithub(){
  const [me,setMe]=useState<any>(null);
  const [repos,setRepos]=useState<any[]>([]);
  const [connections,setConnections]=useState<any[]>([]);
  const [team,setTeam]=useState<any>(null);
  const [project,setProject]=useState<any>(null);
  const [grant,setGrant]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [actionLoading,setActionLoading]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [success,setSuccess]=useState<string|null>(null);
  const [selectedRepo,setSelectedRepo]=useState<string>('');
  const [authUrl,setAuthUrl]=useState<string | null>(null);

  useEffect(()=>{
    let m=true;
    async function load(){
      setLoading(true); setError(null);
      try{
        const [t,p,ghMe] = await Promise.allSettled([
          hmtBackendService.getMyTeam(),
          hmtBackendService.getMyProject(),
          hmtBackendService.getGitHubMe(),
        ]);
        if(!m) return;
        if(t.status==='fulfilled'){ const tm=(t.value as any)?.team ?? t.value; if(tm?.id) setTeam(tm); else if((t.value as any)?.id) setTeam(t.value); }
        if(p.status==='fulfilled'){ const proj=(p.value as any)?.project ?? p.value; if(proj?.id) setProject(proj);
          if(proj?.id){ try{ const st= await hmtBackendService.checkRepositoryAccess(proj.id); setGrant(st as any); }catch{}
            try{ const hist= await hmtBackendService.getRepositoryAccessHistory(proj.id); /* optional */ }catch{}
          }
        }
        if(ghMe.status==='fulfilled') setMe(ghMe.value as any);
        // try repos if connected
        try{ const r = await hmtBackendService.getGitHubRepositories(); setRepos(Array.isArray(r)? r : (r as any)?.repositories || []); }catch{}
        try{ const c = await hmtBackendService.getGitHubConnections(); setConnections(Array.isArray(c)? c : (c as any)?.connections || []); }catch{}
        // auth url preview
        try{ const a:any = await hmtBackendService.getGitHubAuthUrl(); setAuthUrl(a?.authorizationUrl || a?.installationUrl || null); }catch{}
      }catch(e){ if(m) setError(friendly(e)); }
      finally{ if(m) setLoading(false); }
    }
    load(); return ()=>{m=false}
  },[]);

  async function refreshRepos(){
    setActionLoading('repos'); setError(null);
    try{ const r:any = await hmtBackendService.getGitHubRepositories(); setRepos(Array.isArray(r)? r : r?.repositories || []); setSuccess('Repositories refreshed'); }catch(e){ setError(friendly(e)); } finally{ setActionLoading(null); }
  }
  async function handleConnect(){
    if(!selectedRepo) { setError('Select a repository'); return; }
    if(!team?.id || !project?.id){ setError('Team and project required — leader only'); return; }
    setActionLoading('connect'); setError(null);
    try{
      const res = await hmtBackendService.connectGitHubRepository({ teamId: team.id, projectId: project.id, repoFullName: selectedRepo });
      setProject(res as any); setSuccess(`Repository ${selectedRepo} connected — read-only`);
      // refresh connections
      try{ const c = await hmtBackendService.getGitHubConnections(); setConnections(Array.isArray(c)? c : (c as any)?.connections || []); }catch{}
    }catch(e){ setError(friendly(e)); } finally{ setActionLoading(null); }
  }
  async function handleGrant(){
    if(!team?.id || !project?.id) { setError('Team/project missing'); return; }
    setActionLoading('grant'); setError(null);
    try{ const g = await hmtBackendService.grantAiAccess({ teamId: team.id, projectId: project.id }); setSuccess('AI access granted'); try{ const st= await hmtBackendService.checkRepositoryAccess(project.id); setGrant(st as any);}catch{} }catch(e){ setError(friendly(e)); } finally{ setActionLoading(null); }
  }
  async function handleRevoke(){
    if(!team?.id || !project?.id) { setError('Team/project missing'); return; }
    setActionLoading('revoke'); setError(null);
    try{
      // try to get grant id from grant status or list
      const grantId = grant?.grant?.id || grant?.id || 'current';
      const res = await hmtBackendService.revokeAiAccess(grantId, { teamId: team.id, projectId: project.id });
      setSuccess('AI access revoked — retrieval denied immediately');
      try{ const st= await hmtBackendService.checkRepositoryAccess(project.id); setGrant(st as any);}catch{}
    }catch(e){ setError(friendly(e)); } finally{ setActionLoading(null); }
  }
  async function handleAuthRedirect(){
    try{ const a:any = await hmtBackendService.getGitHubAuthUrl(); const url = a?.authorizationUrl || a?.installationUrl; if(url) window.location.href = url; else setError('No authorization URL returned'); }catch(e){ setError(friendly(e)); }
  }

  if(loading) return <div className="space-y-4"><div className="h-24 animate-pulse rounded-2xl bg-[#e9e5da]"/><div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/></div>

  const isConnected = !!me?.connected;
  const hasGrant = !!grant?.hasAccess;
  const isLeader = team?.members?.some((m:any)=> m.userId && m.role==='LEADER') || true; // fallback assume leader check server enforces

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">GitHub integration · Read-only, never tokens</div>
          <h1 className="mt-2 text-3xl font-bold tracking-[-.05em] text-[#171a2d]">Connect your repo, control the grant.</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#77798a]">Connect GitHub via OAuth — we store tokens encrypted at rest, never display them. Leader selects repo (read-only), then grants/revokes AI analysis. Status shows CONNECTED / GRANTED / REVOKED.</p>
        </div>
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${isConnected ? 'bg-[#d8e35b] text-[#171a2d]' : 'bg-[#e9e5da] text-[#77798a]'}`}>{isConnected ? <><Check size={14}/> CONNECTED</> : <><X size={14}/> NOT CONNECTED</>}</span>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex gap-2"><AlertCircle size={16}/>{error}<button onClick={()=>setError(null)} className="ml-auto"><X size={14}/></button></div>}
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 flex gap-2"><Check size={16}/>{success}<button onClick={()=>setSuccess(null)} className="ml-auto"><X size={14}/></button></div>}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
          <h3 className="font-bold flex items-center gap-2"><Github size={16}/> Connect GitHub</h3>
          <p className="mt-1 text-xs leading-5 text-[#77798a]">Step 1 — Authorize. Step 2 — Leader selects repo. Tokens encrypted, never shown, READ-ONLY to GitHub.</p>

          <div className="mt-5 rounded-xl bg-[#f4f1e8] p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold">GitHub account</div>
              <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${isConnected ? 'bg-[#d8e35b] text-[#171a2d]' : 'bg-[#e9e5da] text-[#77798a]'}`}>{isConnected ? 'CONNECTED' : 'NOT CONNECTED'}</span>
            </div>
            {isConnected ? (
              <div className="mt-3">
                <div className="text-sm font-bold">{me.githubLogin || me.login || 'github-user'}</div>
                <div className="text-xs text-[#77798a]">ID {me.githubUserId || me.id || '—'} · provider {me.provider || 'github'}</div>
                <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-white border border-[#dedbd1] px-2 py-1 text-[11px]"><ShieldCheck size={12} className="text-[#5aafbd]"/> Encrypted at rest · never display tokens</div>
              </div>
            ) : (
              <div className="mt-3">
                <p className="text-xs leading-5 text-[#77798a]">No GitHub connection yet. Redirect to GitHub OAuth via authenticated <code className="rounded bg-white px-1">GET /github/auth</code> → authorizationUrl.</p>
                {authUrl && <div className="mt-2 text-[11px] font-mono break-all text-[#77798a]">{authUrl.slice(0,80)}…</div>}
              </div>
            )}
            <button onClick={handleAuthRedirect} className="mt-4 w-full rounded-xl bg-[#171a2d] px-4 py-2.5 text-sm font-bold text-white inline-flex items-center justify-center gap-2"><Github size={16}/> {isConnected ? 'Reconnect GitHub' : 'Connect GitHub'} <ExternalLink size={14}/></button>
            <div className="mt-2 text-[11px] text-[#77798a] flex items-center gap-1"><EyeOff size={12}/> We never show tokens. Read-only messaging enforced.</div>
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between"><h4 className="text-xs font-bold flex items-center gap-2"><GitBranch size={14}/> Repositories</h4><button onClick={refreshRepos} disabled={!!actionLoading} className="rounded-lg border border-[#dedbd1] px-2 py-1 text-xs font-semibold inline-flex items-center gap-1">{actionLoading==='repos'?<Loader2 size={12} className="animate-spin"/>:<RefreshCw size={12}/>} Refresh</button></div>
            {!isConnected ? <div className="mt-3 rounded-xl border border-dashed border-[#dedbd1] p-4 text-xs text-[#77798a]">Connect GitHub to list repositories (<code className="rounded bg-[#f4f1e8] px-1">GET /github/repositories</code>).</div> : repos.length ? (
              <div className="mt-3 space-y-2 max-h-[320px] overflow-auto pr-1">
                {repos.map((r:any)=>(
                  <label key={r.fullName} className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer ${selectedRepo===r.fullName ? 'border-[#f26a4f] bg-[#fdfbf5]' : 'border-[#e5e1d7] bg-white hover:border-[#f26a4f]/50'}`}>
                    <input type="radio" name="repo" checked={selectedRepo===r.fullName} onChange={()=>setSelectedRepo(r.fullName)} className="accent-[#f26a4f]"/>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold truncate">{r.fullName} {r.private && <span className="ml-1 rounded-full bg-[#171a2d] px-1.5 py-0.5 text-[10px] text-white">private</span>}</div>
                      <div className="text-xs text-[#77798a] truncate">{r.description || '—'}</div>
                    </div>
                    <a href={r.htmlUrl} target="_blank" rel="noreferrer" className="text-[#5aafbd]"><ExternalLink size={14}/></a>
                  </label>
                ))}
              </div>
            ) : <div className="mt-3 rounded-xl bg-[#f4f1e8] p-4 text-xs text-[#77798a]">No repositories found. Check GitHub App installation scope.</div>}

            <div className="mt-4 rounded-xl border border-[#e5e1d7] p-3">
              <div className="text-xs font-bold">Leader selects repo → <code className="rounded bg-[#f4f1e8] px-1">POST /github/connections {'{teamId, projectId, repoFullName}'}</code></div>
              <div className="mt-2 text-xs text-[#77798a]">Team: <b className="text-[#171a2d]">{team?.name || '—'}</b> · Project: <b className="text-[#171a2d]">{project?.title || '—'}</b> · {project?.repoUrl ? <span className="text-[#5aafbd]">{project.repoUrl}</span> : 'No repo yet'}</div>
              <button onClick={handleConnect} disabled={!selectedRepo || !team?.id || !project?.id || !!actionLoading} className="mt-3 w-full rounded-xl bg-[#f26a4f] px-4 py-2 text-sm font-bold text-white disabled:opacity-50 inline-flex items-center justify-center gap-2">{actionLoading==='connect'?<Loader2 size={16} className="animate-spin"/>:<Link2 size={16}/>} Connect selected repository</button>
              {(!team?.id || !project?.id) && <div className="mt-2 text-xs text-amber-700">You must be in a team with a project. Only leader can connect — server enforces 403.</div>}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl bg-[#171a2d] p-6 text-[#fdfbf5]">
            <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">Repository connection status</div>
            <div className="mt-4 grid gap-3">
              <div className="rounded-xl bg-[#252941] p-3">
                <div className="flex items-center justify-between text-xs"><span className="text-[#9b9fb1]">Connection</span><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${project?.repoUrl ? 'bg-[#d8e35b] text-[#171a2d]' : 'bg-[#3a3e5a] text-[#9b9fb1]'}`}>{project?.repoUrl ? 'CONNECTED' : 'NOT CONNECTED'}</span></div>
                <div className="mt-2 text-xs truncate">{project?.repoUrl || 'No repoUrl — hidden when no grant'}</div>
              </div>
              <div className="rounded-xl bg-[#252941] p-3">
                <div className="flex items-center justify-between text-xs"><span className="text-[#9b9fb1]">AI grant</span><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${hasGrant?'bg-emerald-400 text-[#171a2d]':'bg-amber-300 text-[#171a2d]'}`}>{hasGrant?'GRANTED':'NOT GRANTED'}</span></div>
                <div className="mt-2 text-xs text-[#b9bdca]">{hasGrant ? `Granted by ${grant?.grant?.grantedById?.slice(0,6) || 'leader'} · ${grant?.grant?.grantedAt ? new Date(grant.grant.grantedAt).toLocaleString(): ''}` : 'No active grant. AI retrieval denied.'}</div>
                {grant?.grant?.revokedAt && <div className="mt-1 text-xs text-red-300">Revoked at {new Date(grant.grant.revokedAt).toLocaleString()} — revoked state shown.</div>}
              </div>
              <div className="rounded-xl border border-[#2c3047] p-3 text-xs leading-5 text-[#b9bdca] flex gap-2"><KeyRound size={14} className="mt-0.5 text-[#d8e35b]"/><span><b className="text-[#fdfbf5]">READ-ONLY messaging.</b> No tokens displayed. Encrypted at rest. GitHub write endpoints do not exist.</span></div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button onClick={handleGrant} disabled={hasGrant || !team?.id || !project?.id || !!actionLoading} className="rounded-xl bg-[#d8e35b] px-3 py-2 text-xs font-bold text-[#171a2d] disabled:opacity-40 inline-flex items-center justify-center gap-1">{actionLoading==='grant'?<Loader2 size={14} className="animate-spin"/>:<Unlock size={14}/>} Grant AI</button>
              <button onClick={handleRevoke} disabled={!hasGrant || !!actionLoading} className="rounded-xl border border-[#3a3e5a] px-3 py-2 text-xs font-bold disabled:opacity-40 inline-flex items-center justify-center gap-1">{actionLoading==='revoke'?<Loader2 size={14} className="animate-spin"/>:<Lock size={14}/>} Revoke</button>
            </div>
            <div className="mt-2 text-[11px] text-[#9b9fb1]">Endpoints: <span className="font-mono">POST /github/grants</span> · <span className="font-mono">POST /github/grants/:id/revoke</span> · <span className="font-mono">GET /repository-access/check/:projectId</span></div>
          </div>

          <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
            <h3 className="font-bold flex items-center gap-2"><ShieldCheck size={16} className="text-[#5aafbd]"/> Connections</h3>
            <div className="mt-3 space-y-2">
              {connections.length ? connections.map((c:any,i:number)=><div key={c.id||i} className="rounded-xl border border-[#e5e1d7] p-3 text-xs"><div className="font-bold">{c.githubLogin || c.login || 'github'}</div><div className="text-[#77798a]">{c.githubUserId || c.userId} · {c.createdAt ? new Date(c.createdAt).toLocaleDateString():''}</div><div className="mt-1 font-mono text-[11px] text-[#aaa9a2]">Token never displayed</div></div>) : <div className="rounded-xl bg-[#f4f1e8] p-3 text-xs text-[#77798a]">No stored connections (GET /github/connections).</div>}
            </div>
            <div className="mt-4 rounded-xl bg-[#f4f1e8] p-3 text-xs leading-5 text-[#77798a]">
              <div className="font-bold text-[#171a2d]">No-grant vs revoked states</div>
              <div>• <b>NO GRANT:</b> AI chat works with limited hackathon context, shows hint that repo not granted.</div>
              <div>• <b>REVOKED:</b> Immediately denies retrieval; AI routes return 403 with user-friendly message. UI shows REVOKED badge.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
