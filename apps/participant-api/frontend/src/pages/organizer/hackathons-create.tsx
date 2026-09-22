import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight, ExternalLink, Loader2, ShieldCheck, Sparkles, Info, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { organizerApi, OrganizerApiError } from '@/services/organizerApi';

const steps = [
  { id:1, label:'Basic info', desc:'Title, objective, audience, duration, mode' },
  { id:2, label:'Type', desc:'Problem Statement vs Open Innovation' },
  { id:3, label:'Theme', desc:'Create or assign themes' },
  { id:4, label:'Resources', desc:'Visibility-scoped resources' },
  { id:5, label:'Rules', desc:'Constraints & rules' },
  { id:6, label:'Timeline', desc:'Phases with start/end' },
  { id:7, label:'Evaluation', desc:'Criteria & weights' },
  { id:8, label:'Mentors', desc:'Assign mentors to teams' },
  { id:9, label:'Review', desc:'Human review gate' },
  { id:10, label:'Confirm', desc:'DRAFT→REVIEW→CONFIRMED→PUBLISHED' },
];

function Field({label,required,error,children}:{label:string;required?:boolean;error?:string;children:React.ReactNode}){
  return <label className="block text-sm font-semibold">{label}{required && <span className="ml-1 text-[#f26a4f]">*</span>}<div className="mt-1.5">{children}</div>{error && <span className="mt-1 block text-xs font-normal text-[#d74635]">{error}</span>}</label>
}

export default function OrganizerHackathonsCreate(){
  const [, setLocation] = useLocation();
  const [current, setCurrent] = useState(1);
  const [hackathonId, setHackathonId] = useState<string|null>(null);
  const [hackathon, setHackathon] = useState<any|null>(null);
  const [draft, setDraft] = useState<any|null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [success, setSuccess] = useState<string|null>(null);

  // form state across steps
  const [form, setForm] = useState({
    title:'', description:'', objective:'Build AI solutions for enterprise', audience:'Students and builders', duration:'3 days', mode:'HYBRID' as any,
    hackathonType:'PROBLEM_STATEMENT_BASED' as 'PROBLEM_STATEMENT_BASED'|'OPEN_INNOVATION',
    problemStatement:'Build an AI-powered software engineering companion', themePreference:'AI', expectedOutcomes:'Prototype, Demo', judgingPreferences:'Innovation, Technical, Impact', resources:'Datasets, APIs', rules:'Original work, Open source',
    themeName:'', themeDesc:'', themeId:'', assignedThemeIds:[] as string[],
    resourceTitle:'', resourceType:'DOCUMENT' as any, resourceUrl:'', resourceVisibility:'PARTICIPANT' as any, resourceContent:'',
    rulesList:'No plagiarism — Be inclusive — Ship in public',
    phaseName:'registration', phaseOrder:1, phaseStartsAt:'', phaseEndsAt:'', phaseDesc:'',
    criteriaName:'', criteriaDesc:'', criteriaWeight:0.25, criteriaMax:10,
    mentorId:'', teamId:'',
  });
  const [themes, setThemes] = useState<any[]>([]);
  const [resources, setResources] = useState<any[]>([]);
  const [phases, setPhases] = useState<any[]>([]);
  const [criteria, setCriteria] = useState<any[]>([]);
  const [mentorAssignments, setMentorAssignments] = useState<any[]>([]);

  const update = (k:string,v:any)=> setForm(f=>({...f,[k]:v}));

  // load themes when entering step 3
  useEffect(()=>{
    if(current===3){
      organizerApi.listThemes().then(setThemes).catch(()=>null);
    }
    if(hackathonId && current>=4){
      organizerApi.listResources(hackathonId).then(setResources).catch(()=>null);
      organizerApi.listPhases(hackathonId).then(setPhases).catch(()=>null);
      organizerApi.listCriteria(hackathonId).then(setCriteria).catch(()=>null);
      organizerApi.listMentorAssignments(hackathonId).then(setMentorAssignments).catch(()=>null);
    }
  },[current, hackathonId]);

  const canNext = ()=>{
    if(current===1) return form.title.trim() && form.description.trim() && form.objective.trim() && form.audience.trim();
    if(current===2) return !!form.hackathonType;
    return true;
  };

  async function handleGenerateDraft(){
    setLoading(true); setError(null); setSuccess(null);
    try{
      const payload = {
        hackathonName: form.title,
        objective: form.objective,
        audience: form.audience,
        duration: form.duration,
        mode: form.mode,
        themePreference: form.themePreference,
        problemStatementBasedOrOpenInnovation: form.hackathonType,
        expectedOutcomes: form.expectedOutcomes,
        judgingPreferences: form.judgingPreferences,
        resources: form.resources,
        rules: form.rules,
      };
      const res = await organizerApi.generateDraft(payload);
      setHackathon(res.hackathon); setDraft(res.draft); setHackathonId(res.hackathon.id);
      setSuccess(`Draft generated — status DRAFT (never auto-published). Id ${res.hackathon.id.slice(0,8)}`);
      setCurrent(3);
    }catch(e:any){
      setError(e instanceof OrganizerApiError ? e.message : (e.message || 'Generate failed'));
    } finally{ setLoading(false)}
  }

  async function handleManualCreate(){
    setLoading(true); setError(null);
    try{
      const payload:any={
        title: form.title,
        description: form.description,
        hackathonType: form.hackathonType,
        objective: form.objective,
        audience: form.audience,
        duration: form.duration,
        mode: form.mode,
        problemStatement: form.hackathonType==='PROBLEM_STATEMENT_BASED' ? form.problemStatement : null,
        constraints: form.rulesList.split(',').map(s=>s.trim()).filter(Boolean),
        expectedOutcomes: form.expectedOutcomes.split(',').map(s=>s.trim()).filter(Boolean),
        rules: form.rulesList.split(',').map(s=>s.trim()).filter(Boolean),
      };
      const h = await organizerApi.createHackathonManual(payload);
      setHackathon(h); setHackathonId(h.id);
      setSuccess(`Manual hackathon created — DRAFT ${h.id.slice(0,8)}`);
      setCurrent(3);
    }catch(e:any){ setError(e.message || 'Create failed') } finally{ setLoading(false)}
  }

  async function createTheme(){
    if(!form.themeName.trim()){ setError('Theme name required'); return }
    setLoading(true); setError(null);
    try{
      const t = await organizerApi.createTheme({ name: form.themeName, description: form.themeDesc });
      setThemes(prev=>[...prev, t]);
      setSuccess(`Theme "${t.name}" created`);
      update('themeName',''); update('themeDesc','');
    }catch(e:any){ setError(e.message) } finally{ setLoading(false)}
  }
  async function assignTheme(){
    if(!hackathonId || !form.themeId){ setError('Select a theme and ensure hackathon exists'); return }
    setLoading(true); setError(null);
    try{
      await organizerApi.assignThemeToHackathon(hackathonId, form.themeId);
      setSuccess('Theme assigned to hackathon');
      update('assignedThemeIds', [...(form.assignedThemeIds as any), form.themeId]);
      const h = await organizerApi.getHackathon(hackathonId); setHackathon(h);
    }catch(e:any){ setError(e.message)} finally{ setLoading(false)}
  }
  async function addResource(){
    if(!hackathonId){ setError('Create hackathon first (Step 1-2)'); return }
    if(!form.resourceTitle.trim()){ setError('Resource title required'); return }
    setLoading(true); setError(null);
    try{
      const r = await organizerApi.createResource(hackathonId, { title: form.resourceTitle, type: form.resourceType, url: form.resourceUrl || null, visibility: form.resourceVisibility, content: form.resourceContent || null });
      setResources(prev=>[...prev, r]);
      setSuccess(`Resource "${r.title}" added (${r.visibility})`);
      update('resourceTitle',''); update('resourceUrl','');
    }catch(e:any){ setError(e.message)} finally{ setLoading(false)}
  }
  async function addPhase(){
    if(!hackathonId){ setError('Create hackathon first'); return }
    if(!form.phaseStartsAt || !form.phaseEndsAt){ setError('Start and end required (ISO datetime)'); return }
    setLoading(true); setError(null);
    try{
      const p = await organizerApi.createPhase(hackathonId, { name: form.phaseName, order: Number(form.phaseOrder), startsAt: new Date(form.phaseStartsAt).toISOString(), endsAt: new Date(form.phaseEndsAt).toISOString(), description: form.phaseDesc });
      setPhases(prev=>[...prev, p]);
      setSuccess(`Phase "${p.name}" created`);
    }catch(e:any){ setError(e.message)} finally{ setLoading(false)}
  }
  async function addCriteria(){
    if(!hackathonId){ setError('Create hackathon first'); return }
    if(!form.criteriaName.trim()){ setError('Criteria name required'); return }
    setLoading(true); setError(null);
    try{
      const c = await organizerApi.createCriteria(hackathonId, { name: form.criteriaName, description: form.criteriaDesc, weight: Number(form.criteriaWeight), maxScore: Number(form.criteriaMax) });
      setCriteria(prev=>[...prev, c]);
      setSuccess(`Criteria "${c.name}" added`);
      update('criteriaName',''); update('criteriaDesc','');
    }catch(e:any){ setError(e.message)} finally{ setLoading(false)}
  }
  async function assignMentor(){
    if(!hackathonId){ setError('Create hackathon first'); return }
    if(!form.mentorId.trim() || !form.teamId.trim()){ setError('mentorId and teamId required'); return }
    setLoading(true); setError(null);
    try{
      const a = await organizerApi.assignMentor(hackathonId, { mentorId: form.mentorId, teamId: form.teamId });
      setMentorAssignments(prev=>[...prev, a]);
      setSuccess(`Mentor assigned to ${form.teamId}`);
    }catch(e:any){ setError(e.message)} finally{ setLoading(false)}
  }

  async function transition(target:'review'|'confirm'|'publish'|'archive'){
    if(!hackathonId){ setError('No hackathon selected'); return }
    setLoading(true); setError(null);
    try{
      let res:any;
      if(target==='review') res = await organizerApi.transitionReview(hackathonId);
      if(target==='confirm') res = await organizerApi.transitionConfirm(hackathonId);
      if(target==='publish') res = await organizerApi.transitionPublish(hackathonId);
      if(target==='archive') res = await organizerApi.transitionArchive(hackathonId);
      const updated = res.hackathon || res;
      setHackathon(updated); setSuccess(`Transition to ${updated.status} successful`);
      if(target==='publish' && res.publishedEvent){
        setDraft((d:any)=>({...d, publishedEvent: res.publishedEvent}));
      }
    }catch(e:any){ setError(e.message)} finally{ setLoading(false)}
  }

  async function tryDirectPublish(){
    if(!hackathonId) return;
    setLoading(true); setError(null);
    try{
      await organizerApi.directPublishBlocked(hackathonId);
      setSuccess('Unexpected: direct publish succeeded (should be blocked)');
    }catch(e:any){ setError(`Guardrail works: ${e.message}`)} finally{ setLoading(false)}
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/organizer/hackathons" className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] p-2"><ArrowLeft size={16}/></Link>
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">Organizer · 10-step wizard</div>
          <h1 className="text-2xl font-bold tracking-[-.04em]">Create hackathon</h1>
          <p className="text-xs text-[#77798a]">DRAFT → REVIEW → CONFIRMED → PUBLISHED → ARCHIVED. AI never auto-publishes.</p>
        </div>
        {hackathon && <span className="ml-auto rounded-full bg-[#d8e35b] px-2.5 py-1 text-[10px] font-bold text-[#171a2d]">{hackathon.status}</span>}
      </div>

      {/* Stepper */}
      <div className="overflow-x-auto rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-2">
        <div className="flex gap-1 min-w-max">
          {steps.map(s=>(
            <button key={s.id} onClick={()=>setCurrent(s.id)} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold whitespace-nowrap ${current===s.id?'bg-[#171a2d] text-white':'bg-[#f4f1e8] text-[#77798a] hover:bg-[#e9e5da]'}`}>
              <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold ${current===s.id?'bg-[#d8e35b] text-[#171a2d]': s.id < current ? 'bg-[#5aafbd] text-white' : 'bg-[#dedbd1] text-[#77798a]'}`}>{s.id < current ? <Check size={10}/> : s.id}</span>{s.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2"><AlertCircle size={16} className="shrink-0 mt-0.5"/><span>{error}</span><button onClick={()=>setError(null)} className="ml-auto text-xs font-bold">Dismiss</button></div>}
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 flex gap-2"><CheckCircle2 size={16} className="shrink-0 mt-0.5"/><span>{success}</span><button onClick={()=>setSuccess(null)} className="ml-auto text-xs font-bold">Dismiss</button></div>}

      <div className="grid gap-6 lg:grid-cols-[1.7fr_.7fr]">
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6 sm:p-8 min-h-[420px]">
          <AnimatePresence mode="wait">
            <motion.div key={current} initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-6}} transition={{duration:0.2}}>

              {current===1 && (
                <div className="space-y-5">
                  <div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-lg bg-[#f26a4f] text-white"><Sparkles size={14}/></span><h2 className="font-bold">Step 1 · Basic info</h2></div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Event title" required><input value={form.title} onChange={e=>update('title',e.target.value)} placeholder="e.g. Orbit / 26 — AI Climate" className="hmt-input" data-testid="input-title"/></Field>
                    <Field label="Duration" required><input value={form.duration} onChange={e=>update('duration',e.target.value)} placeholder="3 days" className="hmt-input"/></Field>
                    <Field label="Mode" required><select value={form.mode} onChange={e=>update('mode',e.target.value)} className="hmt-input"><option>ONLINE</option><option>OFFLINE</option><option>HYBRID</option></select></Field>
                    <Field label="Audience" required><input value={form.audience} onChange={e=>update('audience',e.target.value)} placeholder="Students, researchers…" className="hmt-input"/></Field>
                  </div>
                  <Field label="Description" required><textarea value={form.description} onChange={e=>update('description',e.target.value)} rows={3} placeholder="What should builders make and why now?" className="hmt-input resize-none"/></Field>
                  <Field label="Objective"><input value={form.objective} onChange={e=>update('objective',e.target.value)} className="hmt-input"/></Field>
                  <Field label="Problem statement (for PROBLEM_STATEMENT_BASED)"><textarea value={form.problemStatement} onChange={e=>update('problemStatement',e.target.value)} rows={2} className="hmt-input resize-none" placeholder="Solve water scarcity with AI…"/></Field>

                  <div className="rounded-xl bg-[#fff8e6] border border-amber-200 p-3 flex gap-2 text-xs leading-5"><Info size={14} className="text-amber-600 shrink-0 mt-0.5"/><span><b>AI draft:</b> Fill expected outcomes, judging prefs, resources, rules, themePreference — then generate a draft in DRAFT (never published).</span></div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Expected outcomes"><input value={form.expectedOutcomes} onChange={e=>update('expectedOutcomes',e.target.value)} className="hmt-input" placeholder="Prototype, Report"/></Field>
                    <Field label="Judging preferences"><input value={form.judgingPreferences} onChange={e=>update('judgingPreferences',e.target.value)} className="hmt-input" placeholder="Innovation, Technical"/></Field>
                    <Field label="Theme preference"><input value={form.themePreference} onChange={e=>update('themePreference',e.target.value)} className="hmt-input" placeholder="Climate, AI"/></Field>
                    <Field label="Resources (freeform)"><input value={form.resources} onChange={e=>update('resources',e.target.value)} className="hmt-input"/></Field>
                  </div>
                  <Field label="Rules (freeform)"><input value={form.rules} onChange={e=>update('rules',e.target.value)} className="hmt-input" placeholder="Original work, Open source"/></Field>
                </div>
              )}

              {current===2 && (
                <div className="space-y-6">
                  <h2 className="font-bold">Step 2 · Type</h2>
                  <p className="text-sm text-[#77798a]">Choose hackathon archetype — influences problem statement requirements and publishing validation.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      { id:'PROBLEM_STATEMENT_BASED', title:'Problem Statement Based', desc:'Builders solve a concrete problem with constraints. Requires problemStatement before CONFIRMED/PUBLISHED.', icon:'🎯' },
                      { id:'OPEN_INNOVATION', title:'Open Innovation', desc:'Broad objective, theme-driven. No fixed problem statement. Flexible outcomes.', icon:'💡' },
                    ].map(opt=>(
                      <button key={opt.id} onClick={()=>update('hackathonType',opt.id)} className={`text-left rounded-2xl border p-5 ${form.hackathonType===opt.id?'border-[#f26a4f] bg-[#fff6f3]':'border-[#e5e1d7] bg-white hover:border-[#f26a4f]/40'}`}>
                        <div className="text-xl">{opt.icon}</div><div className="mt-2 font-bold">{opt.title}</div><p className="mt-1 text-xs leading-5 text-[#77798a]">{opt.desc}</p>
                        {form.hackathonType===opt.id && <span className="mt-3 inline-flex rounded-full bg-[#f26a4f] px-2 py-1 text-[10px] font-bold text-white">Selected</span>}
                      </button>
                    ))}
                  </div>
                  {form.hackathonType==='PROBLEM_STATEMENT_BASED' && !form.problemStatement.trim() && <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700 flex gap-2"><AlertTriangle size={14}/> Problem statement required before CONFIRMED for this type.</div>}
                </div>
              )}

              {current===3 && (
                <div className="space-y-5">
                  <h2 className="font-bold">Step 3 · Theme</h2>
                  <p className="text-sm text-[#77798a]">POST /themes, GET /themes, POST /hackathons/:id/themes — configurable, not hard-coded.</p>

                  <div className="rounded-xl bg-[#f4f1e8] p-4 space-y-3">
                    <div className="text-xs font-bold">Create new theme</div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input value={form.themeName} onChange={e=>update('themeName',e.target.value)} placeholder="e.g. Quantum Systems" className="hmt-input mt-0"/>
                      <input value={form.themeDesc} onChange={e=>update('themeDesc',e.target.value)} placeholder="Description" className="hmt-input mt-0"/>
                    </div>
                    <button onClick={createTheme} disabled={loading} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{loading?'Creating…':'Create theme'}</button>
                  </div>

                  <div className="flex gap-2">
                    <button onClick={async()=>{ setLoading(true); try{ await organizerApi.seedThemes(); const l=await organizerApi.listThemes(); setThemes(l); setSuccess('Seeded AI, FinTech, HealthTech, Climate etc.'); }catch(e:any){setError(e.message)} finally{setLoading(false)} }} className="rounded-xl border border-[#dedbd1] px-3 py-2 text-xs font-semibold">Seed defaults (AI, FinTech…)</button>
                    <button onClick={async()=>{ const l=await organizerApi.listThemes(); setThemes(l); setSuccess(`${l.length} themes`)} } className="rounded-xl border border-[#dedbd1] px-3 py-2 text-xs font-semibold">Refresh</button>
                  </div>

                  <div className="grid gap-2 max-h-40 overflow-auto pr-1">
                    {themes.length ? themes.map((t:any)=><div key={t.id} className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs ${form.themeId===t.id?'border-[#f26a4f] bg-[#fff6f3]':'border-[#e5e1d7] bg-white'}`}><span><b>{t.name}</b> <span className="text-[#77798a]">{t.description?.slice(0,40)||''}</span></span><button onClick={()=>update('themeId',t.id)} className="rounded-lg bg-[#171a2d] px-2 py-1 text-[11px] font-bold text-white">{form.themeId===t.id?'Selected':'Select'}</button></div>) : <div className="text-xs text-[#77798a]">No themes yet — create one or seed defaults.</div>}
                  </div>

                  {hackathonId ? (
                    <div className="flex gap-2">
                      <button onClick={assignTheme} disabled={!form.themeId || loading} className="rounded-xl bg-[#f26a4f] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Assign theme to hackathon</button>
                      <span className="text-xs text-[#77798a] py-2">Assigned: {(hackathon?.themeIds?.length || form.assignedThemeIds.length || 0)} theme(s)</span>
                    </div>
                  ) : <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700">Create hackathon first (generate draft or manual) in Step 1-2, then assign themes.</div>}
                </div>
              )}

              {current===4 && (
                <div className="space-y-5">
                  <h2 className="font-bold">Step 4 · Resources</h2>
                  <p className="text-sm text-[#77798a]">POST /hackathons/:id/resources with visibility PUBLIC / PARTICIPANT / MENTOR / ORGANIZER.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Title" required><input value={form.resourceTitle} onChange={e=>update('resourceTitle',e.target.value)} placeholder="Dataset Link" className="hmt-input mt-0"/></Field>
                    <Field label="Type"><select value={form.resourceType} onChange={e=>update('resourceType',e.target.value)} className="hmt-input mt-0"><option>DOCUMENT</option><option>LINK</option><option>API</option><option>DATASET</option><option>SDK</option><option>RULES</option><option>STARTER</option><option>OTHER</option></select></Field>
                    <Field label="URL"><input value={form.resourceUrl} onChange={e=>update('resourceUrl',e.target.value)} placeholder="https://example.com/data.csv" className="hmt-input mt-0"/></Field>
                    <Field label="Visibility"><select value={form.resourceVisibility} onChange={e=>update('resourceVisibility',e.target.value)} className="hmt-input mt-0"><option>PUBLIC</option><option>PARTICIPANT</option><option>MENTOR</option><option>ORGANIZER</option></select></Field>
                  </div>
                  <Field label="Content (for DOCUMENT)"><textarea value={form.resourceContent} onChange={e=>update('resourceContent',e.target.value)} rows={2} className="hmt-input resize-none"/></Field>
                  <button onClick={addResource} disabled={loading} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Add resource</button>
                  <div className="space-y-2">
                    {resources.map((r:any)=><div key={r.id} className="flex items-center justify-between rounded-xl border border-[#e5e1d7] bg-white px-3 py-2 text-xs"><span><b>{r.title}</b> · {r.type} · <span className="rounded-full bg-[#f4f1e8] px-2 py-0.5 text-[10px] font-bold">{r.visibility}</span></span><span className="text-[#77798a]">{r.url?.slice(0,20)||'—'}</span></div>)}
                    {resources.length===0 && <div className="text-xs text-[#77798a]">No resources yet.</div>}
                  </div>
                  <div className="rounded-xl bg-[#eef6f7] border border-[#bfe0e2] p-3 text-xs leading-5">Participant sees PUBLIC + PARTICIPANT only. Mentor sees +MENTOR. Organizer sees all. Verified via filtered GET.</div>
                </div>
              )}

              {current===5 && (
                <div className="space-y-5">
                  <h2 className="font-bold">Step 5 · Rules</h2>
                  <p className="text-sm text-[#77798a]">Constraints, rules, expected outcomes — editable while DRAFT/REVIEW. Updating via PATCH /hackathons/:id.</p>
                  <Field label="Rules (comma separated)"><textarea value={form.rulesList} onChange={e=>update('rulesList',e.target.value)} rows={3} className="hmt-input resize-none"/></Field>
                  {hackathonId && <button onClick={async()=>{ setLoading(true); setError(null); try{ const updated=await organizerApi.updateHackathon(hackathonId,{ rules: form.rulesList.split(',').map(s=>s.trim()).filter(Boolean)}); setHackathon(updated); setSuccess('Rules updated'); }catch(e:any){setError(e.message)} finally{setLoading(false)}}} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white">Save rules to hackathon</button>}
                </div>
              )}

              {current===6 && (
                <div className="space-y-5">
                  <h2 className="font-bold">Step 6 · Timeline</h2>
                  <p className="text-sm text-[#77798a]">POST /hackathons/:id/phases — must not overlap, start &lt; end, sequential order.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Name"><select value={form.phaseName} onChange={e=>update('phaseName',e.target.value)} className="hmt-input mt-0"><option>registration</option><option>team_formation</option><option>ideation</option><option>development</option><option>evaluation</option><option>submission</option><option>finale</option><option>results</option></select></Field>
                    <Field label="Order"><input type="number" value={form.phaseOrder} onChange={e=>update('phaseOrder',Number(e.target.value))} className="hmt-input mt-0"/></Field>
                    <Field label="Starts at (local)"><input type="datetime-local" value={form.phaseStartsAt} onChange={e=>update('phaseStartsAt',e.target.value)} className="hmt-input mt-0"/></Field>
                    <Field label="Ends at (local)"><input type="datetime-local" value={form.phaseEndsAt} onChange={e=>update('phaseEndsAt',e.target.value)} className="hmt-input mt-0"/></Field>
                  </div>
                  <Field label="Description"><input value={form.phaseDesc} onChange={e=>update('phaseDesc',e.target.value)} placeholder="Build & ship" className="hmt-input mt-0"/></Field>
                  <button onClick={addPhase} disabled={loading} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Add phase</button>
                  <div className="space-y-2">
                    {phases.map((p:any)=><div key={p.id} className="flex justify-between rounded-xl border border-[#e5e1d7] bg-white px-3 py-2 text-xs"><span><b>#{p.order} {p.name}</b> · {new Date(p.startsAt).toLocaleDateString()} → {new Date(p.endsAt).toLocaleDateString()}</span><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${p.status==='ACTIVE'?'bg-[#d8e35b] text-[#171a2d]':'bg-[#f4f1e8]'}`}>{p.status}</span></div>)}
                    {phases.length===0 && <div className="text-xs text-[#77798a]">No phases yet. Add registration → results.</div>}
                  </div>
                </div>
              )}

              {current===7 && (
                <div className="space-y-5">
                  <h2 className="font-bold">Step 7 · Evaluation criteria</h2>
                  <p className="text-sm text-[#77798a]">POST /hackathons/:id/evaluation-criteria — configurable, not hardcoded. Validates weight 0.01-1 and unique names.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Name" required><input value={form.criteriaName} onChange={e=>update('criteriaName',e.target.value)} placeholder="Innovation" className="hmt-input mt-0"/></Field>
                    <Field label="Weight (0.01-1)"><input type="number" step="0.05" value={form.criteriaWeight} onChange={e=>update('criteriaWeight',e.target.value)} className="hmt-input mt-0"/></Field>
                    <Field label="Description"><input value={form.criteriaDesc} onChange={e=>update('criteriaDesc',e.target.value)} className="hmt-input mt-0"/></Field>
                    <Field label="Max score"><input type="number" value={form.criteriaMax} onChange={e=>update('criteriaMax',e.target.value)} className="hmt-input mt-0"/></Field>
                  </div>
                  <button onClick={addCriteria} disabled={loading} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Add criteria</button>
                  <div className="space-y-2">
                    {criteria.map((c:any)=><div key={c.id} className="flex justify-between rounded-xl border border-[#e5e1d7] bg-white px-3 py-2 text-xs"><span><b>{c.name}</b> · weight {c.weight} · max {c.maxScore}</span><button onClick={async()=>{ await organizerApi.deleteCriteria(c.id); setCriteria(prev=>prev.filter(x=>x.id!==c.id))}} className="text-[11px] font-bold text-[#f26a4f]">Remove</button></div>)}
                    {criteria.length===0 && <div className="text-xs text-[#77798a]">No criteria yet. Add Innovation, Technical, Impact, etc.</div>}
                    <div className="text-xs text-[#77798a]">Total weight ideally ≤1. Known examples: Innovation, Technical implementation, Impact, UX, Scalability, Presentation (all supported).</div>
                  </div>
                </div>
              )}

              {current===8 && (
                <div className="space-y-5">
                  <h2 className="font-bold">Step 8 · Mentors</h2>
                  <p className="text-sm text-[#77798a]">POST /hackathons/:id/mentor-assignments — organizer assigns mentor to team. Requires mentorId (user id) and teamId.</p>
                  <div className="rounded-xl bg-[#f4f1e8] p-3 text-xs leading-5">To get mentorId: register a user with role MENTOR and copy its id. For teamId: you can use any team created for demo, or seed demo data which creates teams automatically. Or create a team id manually and assign — backend accepts arbitrary teamId if you set in memory for testing.</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Mentor user id" required><input value={form.mentorId} onChange={e=>update('mentorId',e.target.value)} placeholder="mentor uuid" className="hmt-input mt-0"/></Field>
                    <Field label="Team id" required><input value={form.teamId} onChange={e=>update('teamId',e.target.value)} placeholder="team_xxx" className="hmt-input mt-0"/></Field>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={assignMentor} disabled={loading} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Assign mentor</button>
                    {hackathonId && <button onClick={async()=>{ if(!hackathonId) return; setLoading(true); try{ await organizerApi.seedDemo(hackathonId); setSuccess('Seeded demo teams/participants/projects'); const teams=await organizerApi.listTeams(hackathonId); if(teams[0]) update('teamId',teams[0].id)}catch(e:any){setError(e.message)} finally{setLoading(false)}}} className="rounded-xl border border-[#dedbd1] px-3 py-2 text-xs font-semibold">Seed demo teams</button>}
                  </div>
                  <div className="space-y-2">
                    {mentorAssignments.map((a:any)=><div key={a.id} className="flex justify-between rounded-xl border border-[#e5e1d7] bg-white px-3 py-2 text-xs"><span>Mentor {a.mentorId.slice(0,8)} → Team {a.teamId.slice(0,8)}</span><span className="text-[#77798a]">{new Date(a.assignedAt).toLocaleDateString()}</span></div>)}
                    {mentorAssignments.length===0 && <div className="text-xs text-[#77798a]">No assignments yet.</div>}
                  </div>
                </div>
              )}

              {current===9 && (
                <div className="space-y-5">
                  <h2 className="font-bold">Step 9 · Review</h2>
                  {hackathon ? (
                    <div className="space-y-3">
                      <div className="rounded-xl bg-[#f4f1e8] p-4 text-sm leading-6">
                        <div className="font-bold">{hackathon.title}</div>
                        <div className="text-[#77798a]">{hackathon.description}</div>
                        <div className="mt-2 text-xs"><b>Type:</b> {hackathon.hackathonType} · <b>Mode:</b> {hackathon.mode} · <b>Status:</b> <span className="rounded-full bg-[#d8e35b] px-2 py-1 text-[10px] font-bold">{hackathon.status}</span></div>
                        <div className="mt-2 text-xs">ThemeIds: {hackathon.themeIds?.join(', ') || '—'} · Rules: {hackathon.rules?.slice(0,3).join(', ') || '—'}</div>
                      </div>
                      {draft && <div className="rounded-xl border border-[#dedbd1] bg-white p-4"><div className="text-xs font-bold">Draft preview (AI)</div><p className="mt-2 text-xs leading-5 text-[#77798a]">{draft.description?.slice(0,300) || JSON.stringify(draft).slice(0,300)}</p><div className="mt-2 text-[11px] text-[#5aafbd]">Generator: {draft.generatorVersion || 'mock-ai-v1'} · Judging criteria draft: {draft.judgingCriteriaDraft?.length||0} · Phases draft: {draft.phasesDraft?.length||0}</div></div>}
                      <div className="grid gap-2 sm:grid-cols-3 text-xs">
                        <div className="rounded-xl bg-white border border-[#e5e1d7] p-3"><b>Themes</b><div className="mt-1 text-[#77798a]">{themes.length} available, {hackathon.themeIds?.length||0} assigned</div></div>
                        <div className="rounded-xl bg-white border border-[#e5e1d7] p-3"><b>Resources</b><div className="mt-1 text-[#77798a]">{resources.length} added</div></div>
                        <div className="rounded-xl bg-white border border-[#e5e1d7] p-3"><b>Timeline</b><div className="mt-1 text-[#77798a]">{phases.length} phases</div></div>
                        <div className="rounded-xl bg-white border border-[#e5e1d7] p-3"><b>Criteria</b><div className="mt-1 text-[#77798a]">{criteria.length} criteria</div></div>
                        <div className="rounded-xl bg-white border border-[#e5e1d7] p-3"><b>Mentors</b><div className="mt-1 text-[#77798a]">{mentorAssignments.length} assignments</div></div>
                        <div className="rounded-xl bg-white border border-[#e5e1d7] p-3"><b>Guardrail</b><div className="mt-1 text-[#77798a]">Must go through REVIEW → CONFIRMED</div></div>
                      </div>
                      <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 flex gap-2"><AlertTriangle size={14} className="shrink-0"/> Human review required: please verify every AI-generated field before confirming.</div>
                    </div>
                  ) : <div className="text-sm text-[#77798a]">No hackathon yet — generate draft or create manually in Step 1.</div>}
                </div>
              )}

              {current===10 && (
                <div className="space-y-5">
                  <h2 className="font-bold">Step 10 · Confirm & Publish</h2>
                  <div className="rounded-xl bg-[#171a2d] p-4 text-[#fdfbf5]">
                    <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">State machine</div>
                    <div className="mt-2 flex flex-wrap gap-1.5 items-center text-xs font-bold">
                      {['DRAFT','REVIEW','CONFIRMED','PUBLISHED','ARCHIVED'].map(s=> <span key={s} className={`rounded-full px-2.5 py-1 ${hackathon?.status===s?'bg-[#d8e35b] text-[#171a2d]':'bg-[#2a2e45] text-[#9b9fb1]'}`}>{s}</span>)}
                    </div>
                    <p className="mt-3 text-xs leading-5 text-[#b9bdca]">Allowed: DRAFT→REVIEW→CONFIRMED→PUBLISHED→ARCHIVED. <b className="text-[#f26a4f]">Direct DRAFT→PUBLISHED is blocked (400).</b> AI content never auto-publishes.</p>
                  </div>

                  {!hackathonId ? <div className="text-sm text-[#77798a]">Create hackathon first.</div> : (
                    <div className="grid gap-2">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <button onClick={()=>transition('review')} disabled={loading || hackathon?.status!=='DRAFT'} className="rounded-xl bg-[#5aafbd] px-3 py-3 text-xs font-bold text-white disabled:opacity-40">→ REVIEW</button>
                        <button onClick={()=>transition('confirm')} disabled={loading || hackathon?.status!=='REVIEW'} className="rounded-xl bg-[#f26a4f] px-3 py-3 text-xs font-bold text-white disabled:opacity-40">→ CONFIRMED</button>
                        <button onClick={()=>transition('publish')} disabled={loading || hackathon?.status!=='CONFIRMED'} className="rounded-xl bg-[#d8e35b] px-3 py-3 text-xs font-bold text-[#171a2d] disabled:opacity-40">→ PUBLISHED</button>
                        <button onClick={()=>transition('archive')} disabled={loading || hackathon?.status!=='PUBLISHED'} className="rounded-xl bg-[#171a2d] px-3 py-3 text-xs font-bold text-white disabled:opacity-40">→ ARCHIVED</button>
                      </div>
                      <button onClick={tryDirectPublish} disabled={loading} className="rounded-xl border border-[#dedbd1] px-3 py-2 text-xs font-semibold">Test guardrail: Direct AI → PUBLISHED (should 400)</button>
                      {hackathon?.status==='PUBLISHED' && <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-700 flex gap-2"><CheckCircle2 size={14}/> Published! <Link href={`/organizer/hackathons/${hackathonId}`} className="font-bold underline">View workspace</Link></div>}
                      <div className="rounded-xl border border-[#e5e1d7] bg-white p-3 text-xs">
                        <div className="font-bold">Current</div>
                        <div className="mt-1">Id: <span className="font-mono">{hackathonId}</span> · Status: <b>{hackathon?.status}</b> · Version: {hackathon?.version}</div>
                        {hackathon?.status==='ARCHIVED' && <div className="mt-1 text-[#77798a]">Terminal — no further transitions.</div>}
                      </div>
                    </div>
                  )}
                </div>
              )}

            </motion.div>
          </AnimatePresence>
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          <div className="rounded-2xl bg-[#171a2d] p-6 text-[#fdfbf5]">
            <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">Progress</div>
            <div className="mt-3 text-2xl font-bold">{current}/10</div>
            <div className="mt-2 h-2 rounded-full bg-[#2a2e45]"><div className="h-full rounded-full bg-[#d8e35b] transition-all" style={{width:`${current*10}%`}}/></div>
            <div className="mt-3 space-y-1.5">
              {steps.map(s=> <div key={s.id} className={`flex items-center gap-2 text-xs ${s.id===current?'text-white font-bold': s.id<current?'text-[#9b9fb1]':'text-[#77798a]'}`}><span className={`h-1.5 w-1.5 rounded-full ${s.id<current?'bg-[#5aafbd]': s.id===current?'bg-[#d8e35b]':'bg-[#3a3e5a]'}`}/>{s.label}</div>)}
            </div>
            {hackathonId && <div className="mt-4 rounded-xl bg-[#252941] p-3 text-xs"><div className="text-[#9b9fb1]">Hackathon</div><div className="font-mono font-bold">{hackathonId.slice(0,8)}</div><div className="mt-1 text-[11px] text-[#b9bdca]">{hackathon?.title}</div></div>}
          </div>

          <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5">
            <h3 className="font-bold text-sm">Actions</h3>
            <div className="mt-3 space-y-2">
              {current===1 && (
                <>
                  <button onClick={handleGenerateDraft} disabled={loading || !canNext()} className="w-full rounded-xl bg-[#f26a4f] px-3 py-3 text-xs font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2">{loading ? <Loader2 size={14} className="animate-spin"/> : <Sparkles size={14}/>} Generate AI draft (DRAFT)</button>
                  <button onClick={handleManualCreate} disabled={loading || !canNext()} className="w-full rounded-xl border border-[#dedbd1] px-3 py-3 text-xs font-bold disabled:opacity-50">Create manually (DRAFT)</button>
                  <p className="text-[11px] leading-4 text-[#77798a]">Both create DRAFT. AI draft is provider-agnostic (mock-ai-v1) and <b>never</b> publishes automatically.</p>
                </>
              )}
              {current>1 && current<10 && <button onClick={()=> setCurrent(c=> Math.min(10, c+1))} disabled={!hackathonId && current>=3} className="w-full rounded-xl bg-[#171a2d] px-3 py-3 text-xs font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2">Next step <ChevronRight size={14}/></button>}
              <div className="flex gap-2">
                <button onClick={()=> setCurrent(c=> Math.max(1, c-1))} disabled={current===1} className="flex-1 rounded-xl border border-[#dedbd1] px-3 py-2 text-xs font-semibold disabled:opacity-40">Back</button>
                <button onClick={()=> setCurrent(c=> Math.min(10, c+1))} disabled={current===10} className="flex-1 rounded-xl border border-[#dedbd1] px-3 py-2 text-xs font-semibold disabled:opacity-40">Skip</button>
              </div>
              {hackathonId && <Link href={`/organizer/hackathons/${hackathonId}`} className="flex items-center justify-center gap-1 rounded-xl border border-[#dedbd1] px-3 py-2 text-xs font-semibold">Open workspace <ExternalLink size={12}/></Link>}
            </div>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex gap-2">
            <ShieldCheck size={16} className="text-amber-600 shrink-0 mt-0.5"/>
            <p className="text-xs leading-5 text-amber-800"><b>Guardrail:</b> Direct AI → PUBLISHED is blocked. You must explicitly review and confirm. Try the blocked transition in Step 10.</p>
          </div>
        </div>
      </div>

      <div className="flex justify-between">
        <Link href="/organizer/dashboard" className="text-xs font-bold text-[#77798a] flex items-center gap-1"><ArrowLeft size={14}/> Dashboard</Link>
        <button onClick={()=> setLocation('/organizer/hackathons')} className="text-xs font-bold text-[#f26a4f] flex items-center gap-1">View all hackathons <ArrowRight size={14}/></button>
      </div>
    </div>
  )
}
