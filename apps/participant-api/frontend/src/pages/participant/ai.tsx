import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Send, History, FileText, ShieldAlert, CheckCircle2, Loader2, AlertCircle, X, ChevronRight, Layers, Eye, Lock, Unlock, Brain, BookOpen, MessageSquare, Trash2 } from 'lucide-react';
import { hmtBackendService, ApiError } from '@/services/backendApi';

function friendly(e:unknown){ return e instanceof ApiError? e.message : (e as Error)?.message || 'Failed' }

export default function ParticipantAI(){
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
  const [scope,setScope]=useState<string>('TARGETED');
  const [grant,setGrant]=useState<any>(null);
  const [aiAccess,setAiAccess]=useState<any>(null);
  const [showAnalysis,setShowAnalysis]=useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(()=>{ endRef.current?.scrollIntoView({ behavior:'smooth' }); },[messages]);

  useEffect(()=>{
    let m=true;
    async function load(){
      setLoading(true); setError(null);
      try{
        const [h, p, t, convs] = await Promise.allSettled([
          hmtBackendService.getCurrentHackathon(),
          hmtBackendService.getMyProject(),
          hmtBackendService.getMyTeam(),
          hmtBackendService.getAIConversations(),
        ]);
        if(!m) return;
        if(h.status==='fulfilled') setHackathon(h.value as any);
        if(p.status==='fulfilled'){
          const proj = (p.value as any)?.project ?? p.value;
          if(proj?.id){ setProject(proj);
            try{ const st = await hmtBackendService.checkRepositoryAccess(proj.id); setGrant(st as any);
              // fetch a chat without grant to capture retrieval preview if any?
            }catch{}
          }
        }
        if(t.status==='fulfilled'){ const tm=(t.value as any)?.team ?? t.value; if(tm?.id) setTeam(tm); else if((t.value as any)?.id) setTeam(t.value); }
        try{ const acc = await hmtBackendService.getAiAccessStatus((p.status==='fulfilled'?((p.value as any)?.project ?? p.value)?.id:undefined) ?? undefined); if(m) setAiAccess(acc); }catch{ /* locked */ }
        if(convs.status==='fulfilled'){
          const c:any = convs.value;
          const arr = Array.isArray(c)?c: c?.conversations || c?.data || []
          setConversations(arr);
          if(arr[0]?.id) setActiveId(arr[0].id);
        }
      }catch(e){ if(m) setError(friendly(e)); }
      finally{ if(m) setLoading(false); }
    }
    load(); return ()=>{m=false}
  },[]);

  useEffect(()=>{
    if(!activeId) { setMessages([]); return; }
    let m=true;
    hmtBackendService.getAIConversation(activeId).then((res:any)=>{
      if(!m) return;
      const msgs = res?.messages || res?.conversation?.messages || [];
      setMessages(msgs);
      if(res?.aiContext) {/* use */}
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
        const res:any = await hmtBackendService.postAIConversationMessage(activeId, trimmed, project?.id);
        // res may contain answer + recommendations + hadRepositoryAccess
        const assistant = { role:'ASSISTANT', content: res?.answer || res?.content || 'Hint received.', createdAt: new Date().toISOString(), meta: res };
        setMessages(prev=>[...prev, assistant]);
        if(res?.relevantFiles) setRelevant(res.relevantFiles);
        if(res?.hadRepositoryAccess!==undefined) setScope(res.hadRepositoryAccess ? 'TARGETED + GRANTED' : 'LIMITED — NO GRANT');
        // update readme/relevant preview if returned
        if(res?.readmeContext) setReadme(res.readmeContext);
      } else {
        // create conversation first
        const created:any = await hmtBackendService.createAIConversation({ title: trimmed.slice(0,40), initialMessage: trimmed, projectId: project?.id });
        const conv = created?.conversation || created;
        const msgs = created?.messages || [];
        setConversations(prev=> [conv, ...prev]);
        setActiveId(conv.id);
        setMessages(msgs);
        if(created?.aiContext) setScope(created.aiContext.hadRepositoryAccess ? 'GRANTED' : 'NO GRANT');
        // if created doesn't have messages, fallback to ask
        if(msgs.length===0){
          const res:any = await hmtBackendService.askAITeammate(trimmed, { projectId: project?.id });
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
  const grantStatusLabel = hasGrant ? 'GRANTED' : 'NO GRANT';
  const grantTone = hasGrant ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-amber-100 text-amber-700 border-amber-200';

  if(loading) return <div className="space-y-4"><div className="h-24 animate-pulse rounded-2xl bg-[#e9e5da]"/><div className="h-[520px] animate-pulse rounded-2xl bg-[#e9e5da]"/></div>

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">AI teammate workspace · hints only</div>
          <h1 className="mt-2 text-3xl font-bold tracking-[-.05em] text-[#171a2d]">Think with the machine, ship like a human.</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#77798a]">Get prioritized guidance — never generated code. AI sees only what your grant allows. Read-only retrieval: README + relevant files.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-3 py-1.5 text-[11px] font-bold ${grantTone}`}>{hasGrant? <span className="inline-flex items-center gap-1"><Unlock size={12}/> GRANTED</span> : <span className="inline-flex items-center gap-1"><Lock size={12}/> NO GRANT</span>}</span>
          <span className="rounded-full bg-[#171a2d] px-3 py-1.5 text-[11px] font-bold text-white">{scope}</span>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex gap-2"><AlertCircle size={16}/>{error}<button onClick={()=>setError(null)} className="ml-auto"><X size={14}/></button></div>}
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 flex gap-2"><CheckCircle2 size={16}/>{success}<button onClick={()=>setSuccess(null)} className="ml-auto"><X size={14}/></button></div>}

      {aiAccess && !aiAccess.allowed && (
        <div className="rounded-2xl border border-[#171a2d] bg-[#171a2d] p-4 flex gap-3 text-[#fdfbf5]">
          <Lock size={18} className="text-[#d8e35b] mt-0.5"/>
          <div className="text-sm">
            <b>AI Teammate LOCKED — {aiAccess.derivedStatus ?? aiAccess.code}</b>
            <p className="mt-1 leading-5 text-[#b9bdca]">{aiAccess.message} Backend enforces the live window; frontend hiding alone is never enough.</p>
          </div>
        </div>
      )}
      {!hasGrant && (!aiAccess || aiAccess.allowed) && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex gap-3">
          <ShieldAlert size={18} className="text-amber-600 mt-0.5"/>
          <div className="text-sm">
            <b className="text-amber-800">AI deep repo analysis disabled — no grant.</b>
            <p className="mt-1 text-amber-700 leading-5">Your leader must connect a repository and grant AI access. Without it, AI sees only hackathon + README + public project metadata and will tell you it has limited context. Revoked grants immediately deny retrieval.</p>
            <a href="/participant/github" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-[#171a2d] underline">Go to GitHub → grant <ChevronRight size={12}/></a>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr_300px] h-[640px]">
        {/* Left: history */}
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

        {/* Center: chat */}
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] flex flex-col overflow-hidden">
          <div className="h-12 border-b border-[#e5e1d7] flex items-center justify-between px-4 bg-white">
            <div className="flex items-center gap-2 text-xs font-bold"><Brain size={14} className="text-[#f26a4f]"/> {activeId ? 'Chat' : 'New conversation'} <span className="rounded-full bg-[#f4f1e8] px-2 py-1 text-[10px]">{hasGrant ? 'With repo context' : 'Limited context'}</span></div>
            <span className="font-mono text-[11px] text-[#77798a]">{team?.name || 'No team'} · {project?.title ? String(project.title).slice(0,18) : 'No project'}</span>
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-3 bg-[#fcfaf7]">
            {messages.length===0 && (
              <div className="space-y-3">
                <div className="rounded-2xl bg-[#171a2d] p-5 text-[#fdfbf5]">
                  <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">AI teammate · Hints only, no code generation</div>
                  <h3 className="mt-2 text-lg font-bold">How can we help you ship faster?</h3>
                  <p className="mt-1 text-xs leading-5 text-[#b9bdca]">Ask about architecture, testing, security, or next steps. We never write code — only guide.</p>
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
                <div className="rounded-xl border border-dashed border-[#dedbd1] p-3 text-xs leading-5 text-[#77798a]"><Layers size={14} className="inline mr-1"/> Retrieval: README.md + up to 3 relevant files, targeted by your question. Scope = <code className="rounded bg-[#f4f1e8] px-1">{scope}</code></div>
              </div>
            )}

            {messages.map((m:any,i:number)=>(
              <motion.div key={i} initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-6 ${m.role==='USER' ? 'ml-auto bg-[#171a2d] text-white' : m.isError ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-white border border-[#e5e1d7] text-[#171a2d]'}`}>
                <div className="whitespace-pre-wrap">{m.content}</div>
                {m.meta?.recommendations && <div className="mt-3 grid gap-2">{m.meta.recommendations.slice(0,3).map((r:any,idx:number)=><div key={idx} className="rounded-xl bg-[#f4f1e8] p-2.5 text-xs"><div className="font-bold">{r.title}</div><div className="text-[#77798a]">{r.action}</div><div className="mt-1 inline-flex rounded-full bg-[#d8e35b] px-2 py-0.5 text-[10px] font-bold">{r.category} · {r.impact}</div></div>)}</div>}
                {m.meta?.privacyEnforced && <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-700"><Lock size={12}/> Privacy enforced — limited context</div>}
                <div className="mt-1 text-[11px] font-mono opacity-50">{m.createdAt ? new Date(m.createdAt).toLocaleTimeString(): ''}</div>
              </motion.div>
            ))}
            {sending && <div className="flex items-center gap-2 text-xs text-[#77798a]"><Loader2 size={14} className="animate-spin"/> AI is retrieving & thinking…</div>}
            <div ref={endRef}/>
          </div>

          <form onSubmit={handleSend} className="p-3 border-t border-[#e5e1d7] bg-white flex gap-2">
            <input value={input} onChange={e=>setInput(e.target.value)} placeholder={hasGrant ? "Ask for hints — with repo context…" : "Ask for hints — limited context (no grant)…"} className="flex-1 rounded-xl border border-[#dedbd1] px-3 py-2.5 text-sm outline-none focus:border-[#f26a4f]"/>
            <button disabled={sending || !input.trim()} className="rounded-xl bg-[#f26a4f] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50 inline-flex items-center gap-2"><Send size={16}/> Send</button>
          </form>
        </div>

        {/* Right: analysis context */}
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] flex flex-col overflow-hidden">
          <div className="p-4 border-b border-[#e5e1d7]">
            <h3 className="text-xs font-bold flex items-center gap-2"><Eye size={14}/> Analysis context</h3>
            <p className="mt-1 text-[11px] leading-4 text-[#77798a]">What AI actually sees for this prompt.</p>
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
              {readme ? <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-[#171a2d] p-2 text-[11px] leading-4 text-[#fdfbf5] whitespace-pre-wrap">{readme.slice(0,800)}</pre> : <div className="mt-2 rounded-lg bg-[#f4f1e8] p-3 text-xs text-[#77798a]">{hasGrant ? 'Will be retrieved per question.' : 'No grant — README retrieval is limited and not persisted as deep context.'}</div>}
            </div>

            <div className="rounded-xl border border-[#e5e1d7] p-3">
              <div className="text-xs font-bold">Relevant files · Retrieval scope</div>
              <div className="mt-1 text-[11px] font-mono text-[#77798a]">Scope: {scope} · Budget: targeted (≤3 files)</div>
              <div className="mt-2 space-y-1.5">
                {relevant.length ? relevant.map((f:any,i:number)=><div key={i} className="rounded-lg bg-[#f4f1e8] px-2.5 py-2 text-xs"><div className="font-mono text-[11px] font-bold">{f.path}</div><div className="text-[#77798a] line-clamp-2">{f.retrievalReason || f.reason || 'Targeted retrieval'}</div></div>) : <div className="rounded-lg bg-[#f4f1e8] p-2.5 text-xs text-[#77798a]">No files yet — ask a question to trigger targeted retrieval.</div>}
              </div>
              <div className="mt-3 rounded-lg border border-dashed border-[#dedbd1] p-2.5 text-[11px] leading-4 text-[#77798a]">Hints only — AI never generates code. If revoked, retrieval returns 403 and we show “revoked” badge.</div>
            </div>

            <div className="rounded-xl bg-[#171a2d] p-3 text-[#fdfbf5]">
              <div className="text-xs font-bold text-[#d8e35b]">Grant status</div>
              <div className="mt-2 flex items-center gap-2 text-xs"><span className={`rounded-full px-2 py-1 text-[11px] font-bold ${hasGrant?'bg-[#d8e35b] text-[#171a2d]':'bg-[#3a3e5a] text-[#9b9fb1]'}`}>{grantStatusLabel}</span><span className="text-[#9b9fb1]">{project?.id ? String(project.id).slice(0,8) : 'no project'}</span></div>
              {!hasGrant && <p className="mt-2 text-xs leading-5 text-[#b9bdca]">Leader: connect repo in GitHub, then “Grant AI access”. Revoke immediately denies AI.</p>}
              {hasGrant && <p className="mt-2 text-xs leading-5 text-[#b9bdca]">AI can view repo metadata + findings with retrieval. Tokens never displayed.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
