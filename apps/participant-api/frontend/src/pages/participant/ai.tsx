import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Send, History, FileText, ShieldAlert, CheckCircle2, Loader2, AlertCircle, X, ChevronRight, Layers, Eye, Lock, Unlock, Brain, BookOpen, MessageSquare, Trash2 } from 'lucide-react';
import { hmtBackendService, ApiError } from '@/services/backendApi';
import { useHackathonContext } from '@/hooks/use-hackathon-context';

function friendly(e:unknown){ return e instanceof ApiError? e.message : (e as Error)?.message || 'Failed' }

export default function ParticipantAI({ hackathonId }: { hackathonId?: string }){
  const [conversations,setConversations]=useState<any[]>([]);
  const [activeId,setActiveId]=useState<string|null>(null);
  const [messages,setMessages]=useState<any[]>([]);
  const [input,setInput]=useState('');
  const [loading,setLoading]=useState(true);
  const [sending,setSending]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [success,setSuccess]=useState<string|null>(null);
  const [hackathon,setHackathon]=useState<any>(null);
  const [project,setProject]=useState<any>(null);
  const [team,setTeam]=useState<any>(null);
  const [readme,setReadme]=useState<string|null>(null);
  const [relevant,setRelevant]=useState<any[]>([]);
  const [grant,setGrant]=useState<any>(null);
  const [aiAccess,setAiAccess]=useState<any>(null);
  const [showAnalysis,setShowAnalysis]=useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const ctx = useHackathonContext();
  const scoped = !!hackathonId;
  const contextId = scoped ? String(hackathonId) : ctx.selectedId;

  useEffect(()=>{ endRef.current?.scrollIntoView({ behavior:'smooth' }); },[messages]);

  useEffect(()=>{
    setProject(null); setTeam(null); setGrant(null); setAiAccess(null);
    setConversations([]); setActiveId(null); setMessages([]);
    setReadme(null); setRelevant([]); setError(null);
    if(!scoped && (ctx.loading || !contextId)) { setLoading(!ctx.loading); return; }
    if(scoped && !contextId) { setLoading(false); return; }
    let m=true;
    async function load(){
      setLoading(true); setError(null);
      try{
        const [h, p, t] = await Promise.allSettled([
          (!scoped && ctx.selectedHackathon) ? Promise.resolve(ctx.selectedHackathon) : hmtBackendService.getHackathonById(contextId),
          hmtBackendService.getMyProject(contextId),
          hmtBackendService.getMyTeam(contextId),
        ]);
        if(!m) return;
        let proj: any = null;
        if(h.status==='fulfilled') setHackathon(h.value as any);
        if(p.status==='fulfilled'){
          proj = (p.value as any)?.project ?? p.value;
          if(proj?.id){ setProject(proj);
            try{ const st = await hmtBackendService.checkRepositoryAccess(proj.id); if(m) setGrant(st as any);
            }catch{}
          }
        }
        if(t.status==='fulfilled'){ const tm=(t.value as any)?.team ?? t.value; if(tm?.id && (!tm.hackathonId || String(tm.hackathonId)===String(contextId))) setTeam(tm); else if((t.value as any)?.id && (!(t.value as any)?.hackathonId || String((t.value as any).hackathonId)===String(contextId))) setTeam(t.value); }
        try{ const acc = await hmtBackendService.getAiAccessStatus(proj?.id ?? undefined, contextId ?? undefined); if(m) setAiAccess(acc); }catch {}
        try{
          const c:any = proj?.id
            ? await hmtBackendService.getAIConversations(proj.id, contextId ?? undefined)
            : await hmtBackendService.getAIConversations(undefined, contextId ?? undefined);
          if(!m) return;
          const arr = Array.isArray(c)?c: c?.conversations || c?.data || [];
          const filtered = proj?.id ? arr.filter((x:any)=> !x.projectId || String(x.projectId)===String(proj.id)) : [];
          setConversations(filtered);
          if(filtered[0]?.id) setActiveId(filtered[0].id);
        }catch{ if(m) setConversations([]); }
      }catch(e){ if(m) setError(friendly(e)); }
      finally{ if(m) setLoading(false); }
    }
    load(); return ()=>{m=false}
  },[ctx.loading, contextId, scoped]);

  useEffect(()=>{
    if(!activeId) { setMessages([]); return; }
    let m=true;
    hmtBackendService.getAIConversation(activeId).then((res:any)=>{
      if(!m) return;
      const msgs = res?.messages || res?.conversation?.messages || [];
      setMessages(msgs);
    }).catch(e=> setError(friendly(e)));
    return ()=>{m=false}
  },[activeId]);

  async function handleSend(e?: React.FormEvent){
    e?.preventDefault();
    const trimmed = input.trim();
    if(!trimmed || sending) return;
    setSending(true); setError(null);
    const optimisticUser = { role:'USER', content: trimmed, createdAt: new Date().toISOString() };
    setMessages(prev=>[...prev, optimisticUser]);
    setInput('');
    try{
      if(activeId){
        const res:any = await hmtBackendService.postAIConversationMessage(activeId, trimmed, project?.id, contextId ?? undefined);
        const assistant = { role:'ASSISTANT', content: res?.answer || res?.content || 'Hint received.', createdAt: new Date().toISOString(), meta: res };
        setMessages(prev=>[...prev, assistant]);
        if(res?.relevantFiles) setRelevant(res.relevantFiles);
        if(res?.readmeContext) setReadme(res.readmeContext);
      } else {
        const created:any = await hmtBackendService.createAIConversation({ title: trimmed.slice(0,40), initialMessage: trimmed, projectId: project?.id, hackathonId: contextId ?? undefined });
        const conv = created?.conversation || created;
        const msgs = created?.messages || [];
        setConversations(prev=> [conv, ...prev]);
        setActiveId(conv.id);
        setMessages(msgs);
        if(msgs.length===0){
          const res:any = await hmtBackendService.askAITeammate(trimmed, { projectId: project?.id, hackathonId: contextId ?? undefined });
          setMessages([{ role:'USER', content: trimmed } as any, { role:'ASSISTANT', content: res?.answer || 'Hint received.', meta: res } as any]);
        }
      }
    }catch(err){
      setError(friendly(err));
      setMessages(prev=> [...prev, { role:'ASSISTANT', content: `⚠️ ${friendly(err)}`, isError:true } as any]);
    } finally{ setSending(false); }
  }

  async function createNew(){
    setActiveId(null); setMessages([]); setInput('');
  }

  async function startHint(prompt:string){
    setInput(prompt);
    setTimeout(()=> handleSend(), 80);
  }

  const hasGrant = !!grant?.hasAccess;
  const grantStatusLabel = hasGrant ? 'Access granted' : 'No access';
  const grantTone = hasGrant ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-amber-100 text-amber-700 border-amber-200';

  if(loading) return <div className="space-y-4"><div className="h-24 animate-pulse rounded-2xl bg-[#e9e5da]"/><div className="h-[520px] animate-pulse rounded-2xl bg-[#e9e5da]"/></div>

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">AI teammate</div>
          <h1 className="mt-2 text-3xl font-bold tracking-[-.05em] text-[#171a2d]">Get unstuck, keep building.</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#77798a]">Ask for hints and next steps. It guides you rather than writing code for you.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-3 py-1.5 text-[11px] font-bold ${grantTone}`}>{hasGrant? <span className="inline-flex items-center gap-1"><Unlock size={12}/> Repo access</span> : <span className="inline-flex items-center gap-1"><Lock size={12}/> No repo access</span>}</span>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex gap-2"><AlertCircle size={16}/>{error}<button onClick={()=>setError(null)} className="ml-auto"><X size={14}/></button></div>}
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 flex gap-2"><CheckCircle2 size={16}/>{success}<button onClick={()=>setSuccess(null)} className="ml-auto"><X size={14}/></button></div>}

      <div className="rounded-xl border border-[#dedbd1] bg-[#f4f1e8] px-4 py-2.5 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        {scoped ? (
          <>
            <span className="text-xs text-[#55586a]">
              <a href="/participant/my-hackathons" className="font-bold underline">My Hackathons</a>
              <span className="mx-1.5 text-[#aaa9a2]">/</span>
              <span className="font-bold text-[#171a2d]">{hackathon?.title || 'Hackathon workspace'}</span>
              <span className="mx-1.5 text-[#aaa9a2]">/</span>
              <span>AI Teammate</span>
              <span className="ml-2 text-[#77798a]">· {team?.name || 'No team yet'} · {project?.title ? String(project.title).slice(0,32) : 'No project yet'}</span>
            </span>
            <a href="/participant/my-hackathons" className="text-xs font-bold text-[#171a2d] underline">Switch hackathon</a>
          </>
        ) : ctx.loading ? (
          <span className="text-xs text-[#77798a]">Loading…</span>
        ) : !contextId ? (
          <span className="text-xs text-[#55586a]"><a href="/participant/hackathons" className="font-bold underline">Register for a hackathon</a> to use the AI teammate.</span>
        ) : (
          <>
            <label className="flex items-center gap-2 text-xs font-semibold text-[#55586a]">Hackathon
              <select
                value={contextId}
                onChange={e=>ctx.select(e.target.value || null)}
                className="rounded-lg border border-[#dedbd1] bg-white px-2 py-1.5 text-xs font-bold text-[#171a2d] outline-none"
                aria-label="Select hackathon"
              >
                {ctx.options.map(o=><option key={o.id} value={o.id}>{o.title}{o.registered?'':' (not registered)'}</option>)}
              </select>
            </label>
            {!ctx.selectedIsRegistered && (
              <span className="text-xs text-[#55586a]">Register for this hackathon to use the AI teammate.</span>
            )}
          </>
        )}
      </div>

      {scoped && !loading && !hackathon && (
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-4 text-sm text-[#55586a]">
          <b className="text-[#171a2d]">Not registered for this hackathon.</b>
          <p className="mt-1 leading-5"><a href="/participant/hackathons" className="font-bold underline">Discover hackathons</a> to register, or <a href="/participant/my-hackathons" className="font-bold underline">open My Hackathons</a>.</p>
        </div>
      )}
      {scoped && !loading && hackathon && !team?.id && (
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-4 text-sm text-[#55586a]">
          <b className="text-[#171a2d]">Join a team first.</b>
          <p className="mt-1 leading-5">AI Teammate needs your team context for {hackathon?.title || 'this hackathon'}. <a href="/participant/teams" className="font-bold underline">Create or join a team</a>, then return here.</p>
        </div>
      )}
      {scoped && !loading && team?.id && !project?.id && (
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-4 text-sm text-[#55586a]">
          <b className="text-[#171a2d]">No project yet for {team?.name || 'your team'}.</b>
          <p className="mt-1 leading-5">Create your team's project first. <a href="/participant/projects" className="font-bold underline">Open My Project</a>.</p>
        </div>
      )}

      {aiAccess && !aiAccess.allowed && (
        <div className="rounded-2xl border border-[#171a2d] bg-[#171a2d] p-4 flex gap-3 text-[#fdfbf5]">
          <Lock size={18} className="text-[#d8e35b] mt-0.5"/>
          <div className="text-sm">
            <b>AI teammate is not available right now</b>
            <p className="mt-1 leading-5 text-[#b9bdca]">{aiAccess.message}</p>
          </div>
        </div>
      )}
      {!hasGrant && (!aiAccess || aiAccess.allowed) && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex gap-3">
          <ShieldAlert size={18} className="text-amber-600 mt-0.5"/>
          <div className="text-sm">
            <b className="text-amber-800">The AI can't see your code yet.</b>
            <p className="mt-1 text-amber-700 leading-5">Your team leader can connect a repository and give the AI access. Until then it only knows your hackathon and project details.</p>
            <a href="/participant/github" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-[#171a2d] underline">Connect a repository <ChevronRight size={12}/></a>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr_300px] h-[640px]">
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] flex flex-col overflow-hidden">
          <div className="p-4 border-b border-[#e5e1d7] flex items-center justify-between">
            <h3 className="text-xs font-bold flex items-center gap-2"><History size={14}/> History</h3>
            <button onClick={createNew} className="rounded-lg bg-[#171a2d] px-2.5 py-1 text-[11px] font-bold text-white">New</button>
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-1">
            {conversations.length ? conversations.map((c:any)=>(
              <button key={c.id} onClick={()=>setActiveId(c.id)} className={`w-full text-left rounded-xl px-3 py-2.5 border ${activeId===c.id ? 'bg-[#171a2d] text-white border-[#171a2d]' : 'bg-white border-[#e5e1d7] hover:bg-[#f4f1e8]'}`}>
                <div className="text-xs font-bold line-clamp-1">{c.title || c.projectId || 'AI Teammate Chat'}</div>
                <div className={`mt-1 text-[11px] ${activeId===c.id?'text-[#9b9fb1]':'text-[#77798a]'}`}>{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : ''} · {c.projectId ? String(c.projectId).slice(0,6) : 'general'}</div>
              </button>
            )) : <div className="p-6 text-center"><MessageSquare size={18} className="mx-auto text-[#aaa9a2]"/><p className="mt-2 text-xs font-semibold">No conversations</p><p className="text-xs text-[#77798a]">Start a new chat to get hints.</p></div>}
          </div>
          <div className="p-3 border-t border-[#e5e1d7] bg-[#f4f1e8] text-[11px] text-[#77798a]">{conversations.length} conversations</div>
        </div>

        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] flex flex-col overflow-hidden">
          <div className="h-12 border-b border-[#e5e1d7] flex items-center justify-between px-4 bg-white">
            <div className="flex items-center gap-2 text-xs font-bold"><Brain size={14} className="text-[#f26a4f]"/> {activeId ? 'Chat' : 'New conversation'} <span className="rounded-full bg-[#f4f1e8] px-2 py-1 text-[10px]">{hasGrant ? 'With repo context' : 'Limited context'}</span></div>
            <span className="font-mono text-[11px] text-[#77798a]">{team?.name || 'No team'} · {project?.title ? String(project.title).slice(0,18) : 'No project'}</span>
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-3 bg-[#fcfaf7]">
            {messages.length===0 && (
              <div className="space-y-3">
                <div className="rounded-2xl bg-[#171a2d] p-5 text-[#fdfbf5]">
                  <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">AI teammate</div>
                  <h3 className="mt-2 text-lg font-bold">How can we help you ship faster?</h3>
                  <p className="mt-1 text-xs leading-5 text-[#b9bdca]">Ask about your approach, risks, or what to do next.</p>
                  <div className="mt-4 grid gap-2">
                    {[
                      'How should we prioritize the next 6 hours?',
                      'What risks does our stack introduce for judging?',
                      'Review our README — what is missing for reviewers?',
                      'Which files should we change next and why?',
                    ].map(q=>(
                      <button key={q} onClick={()=>startHint(q)} className="rounded-xl bg-[#252941] px-3 py-2 text-left text-xs hover:bg-[#2f3450]">{q}</button>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-dashed border-[#dedbd1] p-3 text-xs leading-5 text-[#77798a]"><Layers size={14} className="inline mr-1"/> The AI reads your README and the files most relevant to your question.</div>
              </div>
            )}

            {messages.map((m:any,i:number)=>(
              <motion.div key={i} initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-6 ${m.role==='USER' ? 'ml-auto bg-[#171a2d] text-white' : m.isError ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-white border border-[#e5e1d7] text-[#171a2d]'}`}>
                <div className="whitespace-pre-wrap">{m.content}</div>
                {m.meta?.recommendations && <div className="mt-3 grid gap-2">{m.meta.recommendations.slice(0,3).map((r:any,idx:number)=><div key={idx} className="rounded-xl bg-[#f4f1e8] p-2.5 text-xs"><div className="font-bold">{r.title}</div><div className="text-[#77798a]">{r.action}</div><div className="mt-1 inline-flex rounded-full bg-[#d8e35b] px-2 py-0.5 text-[10px] font-bold">{r.category} · {r.impact}</div></div>)}</div>}
                {m.meta?.privacyEnforced && <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-700"><Lock size={12}/> Limited context</div>}
                <div className="mt-1 text-[11px] font-mono opacity-50">{m.createdAt ? new Date(m.createdAt).toLocaleTimeString(): ''}</div>
              </motion.div>
            ))}
            {sending && <div className="flex items-center gap-2 text-xs text-[#77798a]"><Loader2 size={14} className="animate-spin"/> Thinking…</div>}
            <div ref={endRef}/>
          </div>

          <form onSubmit={handleSend} className="p-3 border-t border-[#e5e1d7] bg-white flex gap-2">
            <input value={input} onChange={e=>setInput(e.target.value)} placeholder="Ask a question…" className="flex-1 rounded-xl border border-[#dedbd1] px-3 py-2.5 text-sm outline-none focus:border-[#f26a4f]"/>
            <button disabled={sending || !input.trim()} className="rounded-xl bg-[#f26a4f] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50 inline-flex items-center gap-2"><Send size={16}/> Send</button>
          </form>
        </div>

        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] flex flex-col overflow-hidden">
          <div className="p-4 border-b border-[#e5e1d7]">
            <h3 className="text-xs font-bold flex items-center gap-2"><Eye size={14}/> Analysis context</h3>
            <p className="mt-1 text-[11px] leading-4 text-[#77798a]">What the AI can see.</p>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-4">
            <div className="rounded-xl bg-[#f4f1e8] p-3">
              <div className="text-xs font-bold flex items-center gap-2"><BookOpen size={14}/> Hackathon</div>
              <div className="mt-1 text-xs font-semibold">{hackathon?.title || '—'}</div>
              <p className="mt-1 line-clamp-3 text-xs leading-5 text-[#77798a]">{hackathon?.problemStatement?.slice(0,160) || '—'}</p>
              <div className="mt-2 flex flex-wrap gap-1">{(hackathon?.phases||[]).slice(0,2).map((p:any,i:number)=><span key={i} className="rounded-full bg-white border border-[#dedbd1] px-2 py-1 text-[10px] font-bold">{p.name||p.status}</span>)}</div>
            </div>

            <div className="rounded-xl border border-[#e5e1d7] p-3">
              <div className="text-xs font-bold">README context</div>
              {readme ? <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-[#171a2d] p-2 text-[11px] leading-4 text-[#fdfbf5] whitespace-pre-wrap">{readme.slice(0,800)}</pre> : <div className="mt-2 rounded-lg bg-[#f4f1e8] p-3 text-xs text-[#77798a]">{hasGrant ? 'Will be retrieved per question.' : 'Not available until your team leader gives the AI access.'}</div>}
            </div>

            <div className="rounded-xl border border-[#e5e1d7] p-3">
              <div className="text-xs font-bold">Relevant files</div>
              <div className="mt-2 space-y-1.5">
                {relevant.length ? relevant.map((f:any,i:number)=><div key={i} className="rounded-lg bg-[#f4f1e8] px-2.5 py-2 text-xs"><div className="font-mono text-[11px] font-bold">{f.path}</div><div className="text-[#77798a] line-clamp-2">{f.retrievalReason || f.reason || ''}</div></div>) : <div className="rounded-lg bg-[#f4f1e8] p-2.5 text-xs text-[#77798a]">Ask a question to see which files the AI used.</div>}
              </div>
            </div>

            <div className="rounded-xl bg-[#171a2d] p-3 text-[#fdfbf5]">
              <div className="text-xs font-bold text-[#d8e35b]">Repository access</div>
              <div className="mt-2 flex items-center gap-2 text-xs"><span className={`rounded-full px-2 py-1 text-[11px] font-bold ${hasGrant?'bg-[#d8e35b] text-[#171a2d]':'bg-[#3a3e5a] text-[#9b9fb1]'}`}>{grantStatusLabel}</span></div>
              {!hasGrant && <p className="mt-2 text-xs leading-5 text-[#b9bdca]">Your team leader can grant access from the GitHub page.</p>}
              {hasGrant && <p className="mt-2 text-xs leading-5 text-[#b9bdca]">The AI can read your repository.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
