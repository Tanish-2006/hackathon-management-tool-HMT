import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight, ExternalLink, Loader2, Sparkles, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { organizerApi, OrganizerApiError } from '@/services/organizerApi';

const steps = ['Basic info','Type','Theme','Resources','Rules','Timeline','Evaluation','Participation','Review','Publish'].map((label, index) => ({ id: index + 1, label }));

const hackathonTypeLabels: Record<string, string> = { PROBLEM_STATEMENT_BASED: 'Problem statement', OPEN_INNOVATION: 'Open innovation' };

function Field({label,required,error,children}:{label:string;required?:boolean;error?:string;children:React.ReactNode}){
  return <label className="block text-sm font-semibold">{label}{required && <span className="ml-1 text-[#f26a4f]">*</span>}<div className="mt-1.5">{children}</div>{error && <span className="mt-1 block text-xs font-normal text-[#d74635]">{error}</span>}</label>
}

function parseDurationHours(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/([\d.]+)\s*(hour|hr|day|week|month)s?/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2].toLowerCase();
  const mult = unit.startsWith('hour') || unit.startsWith('hr') ? 1 : unit.startsWith('day') ? 24 : unit.startsWith('week') ? 168 : 730;
  return n * mult;
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

  const [form, setForm] = useState({
    title:'', description:'', objective:'', audience:'', duration:'3 days', mode:'HYBRID' as any,
    hackathonType:'PROBLEM_STATEMENT_BASED' as 'PROBLEM_STATEMENT_BASED'|'OPEN_INNOVATION',
    problemStatement:'', themePreference:'', expectedOutcomes:'', judgingPreferences:'', resources:'', rules:'',
    themeName:'', themeDesc:'', themeId:'', assignedThemeIds:[] as string[],
    resourceTitle:'', resourceType:'DOCUMENT' as any, resourceUrl:'', resourceVisibility:'PARTICIPANT' as any, resourceContent:'',
    rulesList:'',
    phaseName:'registration', phaseOrder:1, phaseStartsAt:'', phaseEndsAt:'', phaseDesc:'',
    eventStart:'', eventEnd:'',
    criteriaName:'', criteriaDesc:'', criteriaWeight:0.25, criteriaMax:10,
    partMode:'BOTH' as 'INDIVIDUAL'|'TEAMS'|'BOTH',
    partMin:2, partMax:4,
    partEligibility:[] as string[],
    partApproval:'AUTOMATIC' as 'AUTOMATIC'|'ORGANIZER_APPROVAL',
    partLimit:'' as string,
    partRequired:['TITLE','DESCRIPTION'] as string[],
    partTeamSubmission:true, partLateAllowed:false,
    partMaxSubs:'' as string,
    partRepoRequirement:'OPTIONAL' as 'REQUIRED'|'OPTIONAL'|'DISABLED',
  });
  const [themes, setThemes] = useState<any[]>([]);
  const [resources, setResources] = useState<any[]>([]);
  const [phases, setPhases] = useState<any[]>([]);
  const [criteria, setCriteria] = useState<any[]>([]);
  const [mentorAssignments, setMentorAssignments] = useState<any[]>([]);
  const [authExpired, setAuthExpired] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: 'registration', order: 1, startsAt: '', endsAt: '', description: '' });
  const orderTouchedRef = useRef(false);
  const partLoadedRef = useRef<string | null>(null);
  useEffect(() => {
    const saved = (hackathon as any)?.metadata?.draft?.participation as any;
    if (hackathonId && saved && typeof saved === 'object' && partLoadedRef.current !== hackathonId) {
      partLoadedRef.current = hackathonId;
      setForm((f) => ({
        ...f,
        partMode: saved.mode ?? f.partMode,
        partMin: saved.teamSize?.min ?? f.partMin,
        partMax: saved.teamSize?.max ?? f.partMax,
        partEligibility: Array.isArray(saved.eligibility) ? saved.eligibility : f.partEligibility,
        partApproval: saved.approval ?? f.partApproval,
        partLimit: saved.participantLimit ?? '',
        partRequired: Array.isArray(saved.submission?.required) ? saved.submission.required : f.partRequired,
        partTeamSubmission: saved.submission?.teamSubmission ?? f.partTeamSubmission,
        partLateAllowed: saved.submission?.lateAllowed ?? f.partLateAllowed,
        partMaxSubs: saved.submission?.maxSubmissions ?? '',
        partRepoRequirement: saved.repoRequirement ?? f.partRepoRequirement,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hackathon, hackathonId]);

  const busyRef = useRef(false);

  const windowLoadedRef = useRef<string | null>(null);
  useEffect(() => {
    const h: any = hackathon;
    if (hackathonId && (h?.eventStart || h?.eventEnd) && windowLoadedRef.current !== hackathonId) {
      windowLoadedRef.current = hackathonId;
      setForm((f) => ({
        ...f,
        eventStart: f.eventStart || (h.eventStart ? toLocalInput(h.eventStart) : ''),
        eventEnd: f.eventEnd || (h.eventEnd ? toLocalInput(h.eventEnd) : ''),
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hackathon, hackathonId]);

  const WIZARD_KEY = 'hmt-hackathon-wizard';
  const CREATE_FIRST_MSG = 'Create the hackathon in Step 1 first.';
  const STALE_MSG = 'This draft no longer exists. Please start again from Step 1.';
  function resetStaleHackathon() {
    setHackathonId(null); setHackathon(null); setDraft(null);
    setPhases([]); setResources([]); setCriteria([]); setMentorAssignments([]);
    setEditingId(null);
    try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(WIZARD_KEY); } catch {}
  }
  function isMissingHackathon(err: any): boolean {
    return err?.status === 404 && /hackathon not found/i.test(String(err?.message || ''));
  }
  useEffect(() => {
    try {
      if (typeof sessionStorage === 'undefined') return;
      const raw = sessionStorage.getItem(WIZARD_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved?.form) setForm((f) => ({ ...f, ...saved.form }));
      if (saved?.current) setCurrent(saved.current);
      if (saved?.hackathonId) {
        const id = saved.hackathonId as string;
        organizerApi.getHackathon(id).then((h) => {
          if (!h) { resetStaleHackathon(); setCurrent(1); setError(STALE_MSG); return; }
          setHackathonId(id); setHackathon(h);
        }).catch((e: any) => {
          if (isMissingHackathon(e)) { resetStaleHackathon(); setCurrent(1); setError(STALE_MSG); }
          else { setHackathonId(id); }
        });
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      if (typeof sessionStorage === 'undefined') return;
      sessionStorage.setItem(WIZARD_KEY, JSON.stringify({ form, hackathonId, current }));
    } catch {}
  }, [form, hackathonId, current]);

  const update = (k:string,v:any)=> setForm(f=>({...f,[k]:v}));

  function nextPhaseOrder(list: any[]): number {
    let max = 0;
    for (const p of list) {
      const o = Number(p?.order);
      if (Number.isInteger(o) && o > max) max = o;
    }
    return max + 1;
  }
  const sortedPhases = useMemo(
    () => [...phases].sort((a: any, b: any) => (Number(a?.order) || 0) - (Number(b?.order) || 0)),
    [phases],
  );
  useEffect(() => {
    if (!orderTouchedRef.current) update('phaseOrder', nextPhaseOrder(phases));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phases]);

  function friendlyPhaseError(err: any, action: string): string {
    const raw = String(err?.message || 'request failed');
    const m = raw.match(/between order\s+(\d+)\s*\([^)]*\)\s*and\s+(\d+)/i) || raw.match(/between order\s+(\d+)\s+and\s+(\d+)/i);
    if (/overlap/i.test(raw) && m) {
      const existing = phases.find((p: any) => Number(p?.order) === Number(m[1]));
      const name = existing?.name ? `"${existing.name}"` : `order ${m[1]}`;
      return `${action}: Phase dates overlap with ${name}. Please choose a later start date.`;
    }
    return `${action}: ${raw}`;
  }

  function markAuthError(err: any): boolean {
    if (err?.status === 401) { setAuthExpired(true); return true; }
    return false;
  }

  function toLocalInput(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

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

  function step1Missing(): string[] {
    const missing: string[] = [];
    if (!form.title.trim()) missing.push('Event title');
    if (!form.description.trim()) missing.push('Description');
    if (!form.objective.trim()) missing.push('Objective');
    if (!form.audience.trim()) missing.push('Audience');
    return missing;
  }

  function aiMissing(): string[] {
    const missing = step1Missing();
    if (!form.themePreference.trim()) missing.push('Theme preference');
    return missing;
  }

  async function handleGenerateDraft(){
    if (busyRef.current || loading) return;
    const missing = aiMissing();
    if (missing.length) { setError(`Please fill in: ${missing.join(', ')}.`); return; }
    if (hackathonId) {
      setError(null);
      setSuccess('Picking up your existing draft.');
      setCurrent(2);
      return;
    }
    busyRef.current = true;
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
      if (res.hackathon?.hackathonType) update('hackathonType', res.hackathon.hackathonType);
      setSuccess('Draft created. Review each step before publishing.');
      setCurrent(2);
    }catch(e:any){
      setError(e instanceof OrganizerApiError ? e.message : (e.message || 'Generate failed'));
    } finally{ setLoading(false); busyRef.current = false; }
  }

  async function handleManualCreate(){
    if (busyRef.current || loading) return;
    const missing = step1Missing();
    if (missing.length) { setError(`Please fill in: ${missing.join(', ')}.`); return; }
    if (hackathonId) {
      setError(null);
      setSuccess('Picking up your existing draft.');
      setCurrent(2);
      return;
    }
    busyRef.current = true;
    setLoading(true); setError(null); setSuccess(null);
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
      setSuccess('Draft created.');
      setCurrent(2);
    }catch(e:any){ setError(e.message || 'Create failed') } finally{ setLoading(false); busyRef.current = false; }
  }

  async function createTheme(){
    if(!form.themeName.trim()){ setError('Enter a theme name.'); return }
    setLoading(true); setError(null);
    try{
      const t = await organizerApi.createTheme({ name: form.themeName, description: form.themeDesc });
      setThemes(prev=>[...prev, t]);
      setSuccess(`Theme "${t.name}" created`);
      update('themeName',''); update('themeDesc','');
    }catch(e:any){ setError(e.message) } finally{ setLoading(false)}
  }
  async function assignTheme(){
    if(!hackathonId || !form.themeId){ setError('Select a theme first.'); return }
    setLoading(true); setError(null);
    try{
      await organizerApi.assignThemeToHackathon(hackathonId, form.themeId);
      setSuccess('Theme assigned.');
      update('assignedThemeIds', [...(form.assignedThemeIds as any), form.themeId]);
      const h = await organizerApi.getHackathon(hackathonId); setHackathon(h);
    }catch(e:any){ setError(e.message)} finally{ setLoading(false)}
  }
  async function addResource(){
    if(!hackathonId){ setError(CREATE_FIRST_MSG); return }
    if(!form.resourceTitle.trim()){ setError('Enter a resource title.'); return }
    setLoading(true); setError(null);
    try{
      const r = await organizerApi.createResource(hackathonId, { title: form.resourceTitle, type: form.resourceType, url: form.resourceUrl || null, visibility: form.resourceVisibility, content: form.resourceContent || null });
      setResources(prev=>[...prev, r]);
      setSuccess(`Resource "${r.title}" added.`);
      update('resourceTitle',''); update('resourceUrl','');
    }catch(e:any){ setError(e.message)} finally{ setLoading(false)}
  }
  async function materializeFromWindow(){
    if (busyRef.current || loading) return;
    if(!hackathonId){ setError(CREATE_FIRST_MSG); return }
    if(!form.eventStart || !form.eventEnd){ setError('Set the event start and end first.'); return }
    const s = new Date(form.eventStart).getTime();
    const e = new Date(form.eventEnd).getTime();
    if (Number.isNaN(s) || Number.isNaN(e) || s >= e) { setError('Event start must be before event end.'); return; }
    busyRef.current = true;
    setLoading(true); setError(null); setAuthExpired(false);
    try{
      const res = await organizerApi.materializeTimeline(hackathonId, { eventStart: new Date(s).toISOString(), eventEnd: new Date(e).toISOString() });
      setHackathon(res.hackathon);
      const list = await organizerApi.listPhases(hackathonId);
      setPhases(list ?? []);
      setSuccess(`Timeline generated: ${(res.phases || []).length} phases fit inside the event window.`);
    }catch(err:any){
      if (isMissingHackathon(err)) { resetStaleHackathon(); setCurrent(1); setError(STALE_MSG); }
      else if (!markAuthError(err)) setError(`Unable to generate timeline: ${err?.message || 'request failed'}`);
      else setError('Your session has expired. Please log in again.');
    } finally{ setLoading(false); busyRef.current = false; }
  }

  async function addPhase(e?: React.FormEvent){
    e?.preventDefault();
    if (busyRef.current || loading) return;
    if(!hackathonId){ setError(CREATE_FIRST_MSG); return }
    if(!form.phaseStartsAt || !form.phaseEndsAt){ setError('Pick a start and end time.'); return }
    const startMs = new Date(form.phaseStartsAt).getTime();
    const endMs = new Date(form.phaseEndsAt).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) { setError('Unable to create phase: Invalid start/end time.'); return; }
    if (startMs >= endMs) { setError('Unable to create phase: start must be before end.'); return; }
    busyRef.current = true;
    setLoading(true); setError(null); setAuthExpired(false);
    try{
      const p = await organizerApi.createPhase(hackathonId, { name: form.phaseName, order: Number(form.phaseOrder), startsAt: new Date(startMs).toISOString(), endsAt: new Date(endMs).toISOString(), description: form.phaseDesc });
      setPhases(prev=>[...prev, p]);
      setSuccess(`Phase "${p.name}" created`);
      orderTouchedRef.current = false;
      update('phaseOrder', Number(p.order) + 1);
      update('phaseStartsAt',''); update('phaseEndsAt',''); update('phaseDesc','');
    }catch(err:any){
      if (isMissingHackathon(err)) { resetStaleHackathon(); setCurrent(1); setError(STALE_MSG); }
      else if (!markAuthError(err)) setError(friendlyPhaseError(err, 'Unable to create phase'));
      else setError('Session expired — please sign in again. Your hackathon and phases are preserved.');
    } finally{ setLoading(false); busyRef.current = false; }
  }

  function startEdit(p: any) {
    setEditingId(p.id);
    setAuthExpired(false);
    setEditForm({
      name: p.name,
      order: Number(p.order) || 1,
      startsAt: toLocalInput(p.startsAt),
      endsAt: toLocalInput(p.endsAt),
      description: p.description ?? '',
    });
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!editingId || busyRef.current || loading) return;
    const order = Number(editForm.order);
    if (!Number.isInteger(order) || order < 1) { setError('Unable to save phase: order must be a positive whole number.'); return; }
    const startMs = new Date(editForm.startsAt).getTime();
    const endMs = new Date(editForm.endsAt).getTime();
    if (!editForm.startsAt || !editForm.endsAt || Number.isNaN(startMs) || Number.isNaN(endMs)) { setError('Unable to save phase: Invalid start/end time.'); return; }
    if (startMs >= endMs) { setError('Unable to save phase: start must be before end.'); return; }
    busyRef.current = true;
    setLoading(true); setError(null); setAuthExpired(false);
    try {
      const updated = await organizerApi.updatePhase(editingId, { name: editForm.name, order, startsAt: new Date(startMs).toISOString(), endsAt: new Date(endMs).toISOString(), description: editForm.description });
      setPhases(prev => prev.map((p: any) => (p.id === editingId ? updated : p)));
      setEditingId(null);
      setSuccess(`Phase "${updated.name}" updated`);
    } catch (err: any) {
      if (isMissingHackathon(err)) { resetStaleHackathon(); setCurrent(1); setError(STALE_MSG); }
      else if (!markAuthError(err)) setError(friendlyPhaseError(err, 'Unable to save phase'));
      else setError('Session expired — please sign in again. Your hackathon and phases are preserved.');
    } finally { setLoading(false); busyRef.current = false; }
  }

  async function deletePhase(phaseId: string, phaseName: string) {
    if (!phaseId || busyRef.current || loading) return;
    if (typeof window !== 'undefined' && !window.confirm(`Delete phase "${phaseName}"? This cannot be undone.`)) return;
    busyRef.current = true;
    setLoading(true); setError(null); setAuthExpired(false);
    try {
      await organizerApi.deletePhase(phaseId);
      setPhases(prev => prev.filter((p: any) => p.id !== phaseId));
      if (editingId === phaseId) setEditingId(null);
      setSuccess(`Phase "${phaseName}" deleted`);
    } catch (err: any) {
      if (isMissingHackathon(err)) { resetStaleHackathon(); setCurrent(1); setError(STALE_MSG); }
      else if (!markAuthError(err)) setError(`Unable to delete phase: ${err?.message || 'request failed'}`);
      else setError('Session expired — please sign in again. Your hackathon and phases are preserved.');
    } finally { setLoading(false); busyRef.current = false; }
  }
  async function addCriteria(){
    if(!hackathonId){ setError(CREATE_FIRST_MSG); return }
    if(!form.criteriaName.trim()){ setError('Enter a criterion name.'); return }
    setLoading(true); setError(null);
    try{
      const c = await organizerApi.createCriteria(hackathonId, { name: form.criteriaName, description: form.criteriaDesc, weight: Number(form.criteriaWeight), maxScore: Number(form.criteriaMax) });
      setCriteria(prev=>[...prev, c]);
      setSuccess(`Criteria "${c.name}" added`);
      update('criteriaName',''); update('criteriaDesc','');
    }catch(e:any){ setError(e.message)} finally{ setLoading(false)}
  }
  async function saveParticipation(){
    if (busyRef.current || loading) return;
    if(!hackathonId){ setError(CREATE_FIRST_MSG); return }
    const teamsOn = form.partMode !== 'INDIVIDUAL';
    const min = Number(form.partMin);
    const max = Number(form.partMax);
    if (teamsOn) {
      if (!Number.isInteger(min) || min < 1) { setError('Minimum team size must be >= 1.'); return; }
      if (!Number.isInteger(max) || max < min) { setError('Maximum team size must be >= minimum team size.'); return; }
    }
    const limit = String(form.partLimit ?? '').trim();
    if (limit !== '' && (!/^\d+$/.test(limit) || Number(limit) < 1)) { setError('Maximum participants must be a positive whole number or empty.'); return; }
    const maxSubs = String(form.partMaxSubs ?? '').trim();
    if (maxSubs !== '' && (!/^\d+$/.test(maxSubs) || Number(maxSubs) < 1)) { setError('Maximum submissions must be a positive whole number or empty.'); return; }
    if (!Array.isArray(form.partRequired) || form.partRequired.length === 0) { setError('Select at least one submission requirement.'); return; }
    busyRef.current = true;
    setLoading(true); setError(null); setAuthExpired(false);
    try{
      const payload: any = {
        participation: {
          mode: form.partMode,
          teamSize: teamsOn ? { min, max } : null,
          eligibility: form.partEligibility,
          approval: form.partApproval,
          participantLimit: limit === '' ? null : Number(limit),
          repoRequirement: form.partRepoRequirement,
          submission: {
            required: form.partRequired,
            teamSubmission: teamsOn ? Boolean(form.partTeamSubmission) : false,
            lateAllowed: Boolean(form.partLateAllowed),
            maxSubmissions: maxSubs === '' ? null : Number(maxSubs),
          },
        },
      };
      const updated = await organizerApi.updateHackathon(hackathonId, payload);
      setHackathon(updated);
      setSuccess('Participation settings saved.');
    }catch(err:any){
      if (isMissingHackathon(err)) { resetStaleHackathon(); setCurrent(1); setError(STALE_MSG); }
      else if (!markAuthError(err)) setError(`Unable to save participation settings: ${err?.message || 'request failed'}`);
      else setError('Your session has expired. Please log in again.');
    } finally{ setLoading(false); busyRef.current = false; }
  }
  async function selectType(type:'PROBLEM_STATEMENT_BASED'|'OPEN_INNOVATION'){
    update('hackathonType', type);
    if (!hackathonId) return;
    try { setHackathon(await organizerApi.updateHackathon(hackathonId, { hackathonType: type })); }
    catch (err:any) { setError(`Unable to save the hackathon type: ${err?.message || 'request failed'}`); }
  }
  async function transition(target:'review'|'confirm'|'publish'|'archive'){
    if(!hackathonId){ setError(CREATE_FIRST_MSG); return }
    setLoading(true); setError(null);
    try{
      let res:any;
      if(target==='review') res = await organizerApi.transitionReview(hackathonId);
      if(target==='confirm') res = await organizerApi.transitionConfirm(hackathonId);
      if(target==='publish') res = await organizerApi.transitionPublish(hackathonId);
      if(target==='archive') res = await organizerApi.transitionArchive(hackathonId);
      const updated = res.hackathon || res;
      setHackathon(updated); setSuccess(`Status changed to ${updated.status}.`);
      if(target==='publish' && res.publishedEvent){
        setDraft((d:any)=>({...d, publishedEvent: res.publishedEvent}));
      }
    }catch(e:any){ setError(e.message)} finally{ setLoading(false)}
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/organizer/hackathons" aria-label="Back" title="Back" className="rounded-xl border border-[#dedbd1] bg-[#fdfbf5] p-2"><ArrowLeft size={16}/></Link>
        <div>
          <h1 className="text-2xl font-bold tracking-[-.04em]">Create hackathon</h1>
        </div>
        {hackathon && <span className="ml-auto rounded-full bg-[#d8e35b] px-2.5 py-1 text-[10px] font-bold text-[#171a2d]">{hackathon.status}</span>}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-2">
        <div className="flex gap-1 min-w-max">
          {steps.map(s=>(
            <button key={s.id} onClick={()=>setCurrent(s.id)} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold whitespace-nowrap ${current===s.id?'bg-[#171a2d] text-white':'bg-[#f4f1e8] text-[#77798a] hover:bg-[#e9e5da]'}`}>
              <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold ${current===s.id?'bg-[#d8e35b] text-[#171a2d]': s.id < current ? 'bg-[#5aafbd] text-white' : 'bg-[#dedbd1] text-[#77798a]'}`}>{s.id < current ? <Check size={10}/> : s.id}</span>{s.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2"><AlertCircle size={16} className="shrink-0 mt-0.5"/><span>{error}</span>{authExpired && <Link href="/login" className="ml-2 shrink-0 text-xs font-bold underline">Sign in again</Link>}<button onClick={()=>{ setError(null); setAuthExpired(false); }} className="ml-auto text-xs font-bold">Dismiss</button></div>}
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 flex gap-2"><CheckCircle2 size={16} className="shrink-0 mt-0.5"/><span>{success}</span><button onClick={()=>setSuccess(null)} className="ml-auto text-xs font-bold">Dismiss</button></div>}

      <div className="grid gap-6 lg:grid-cols-[1.7fr_.7fr]">
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6 sm:p-8 min-h-[420px]">
          <AnimatePresence mode="wait">
            <motion.div key={current} initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-6}} transition={{duration:0.2}}>

              {current===1 && (
                <div className="space-y-5">
                  <div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-lg bg-[#f26a4f] text-white"><Sparkles size={14}/></span><h2 className="font-bold">Step 1 · Basic info</h2></div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Event title" required><input value={form.title} onChange={e=>update('title',e.target.value)} placeholder="e.g. Campus Ideathon 2026" className="hmt-input" data-testid="input-title"/></Field>
                    <Field label="Duration" required><input value={form.duration} onChange={e=>update('duration',e.target.value)} placeholder="3 days" className="hmt-input"/></Field>
                    <Field label="Mode" required><select value={form.mode} onChange={e=>update('mode',e.target.value)} className="hmt-input"><option>ONLINE</option><option>OFFLINE</option><option>HYBRID</option></select></Field>
                    <Field label="Audience" required><input value={form.audience} onChange={e=>update('audience',e.target.value)} placeholder="e.g. College students" className="hmt-input"/></Field>
                  </div>
                  <Field label="Description" required><textarea value={form.description} onChange={e=>update('description',e.target.value)} rows={3} placeholder="What should builders make and why now?" className="hmt-input resize-none"/></Field>
                  <Field label="Objective" required><input value={form.objective} onChange={e=>update('objective',e.target.value)} placeholder="e.g. Find new ideas for campus sustainability" className="hmt-input"/></Field>
                  <Field label="Problem statement"><textarea value={form.problemStatement} onChange={e=>update('problemStatement',e.target.value)} rows={2} className="hmt-input resize-none" placeholder="Only needed if participants solve a specific problem"/></Field>

                  <p className="text-xs text-[#77798a]">Fill these in to generate a draft with AI.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Expected outcomes"><input value={form.expectedOutcomes} onChange={e=>update('expectedOutcomes',e.target.value)} className="hmt-input" placeholder="e.g. Prototype, Pitch deck"/></Field>
                    <Field label="Judging preferences"><input value={form.judgingPreferences} onChange={e=>update('judgingPreferences',e.target.value)} className="hmt-input" placeholder="e.g. Originality, Impact"/></Field>
                    <Field label="Theme preference" required><input value={form.themePreference} onChange={e=>update('themePreference',e.target.value)} className="hmt-input" placeholder="e.g. Sustainability"/></Field>
                    <Field label="Resources"><input value={form.resources} onChange={e=>update('resources',e.target.value)} className="hmt-input" placeholder="e.g. Mentors, Starter kit"/></Field>
                  </div>
                  <Field label="Rules"><input value={form.rules} onChange={e=>update('rules',e.target.value)} className="hmt-input" placeholder="e.g. Teams of up to 4, Original work only"/></Field>
                </div>
              )}

              {current===2 && (
                <div className="space-y-6">
                  <h2 className="font-bold">Step 2 · Type</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      { id:'PROBLEM_STATEMENT_BASED', title:'Problem statement', desc:'Participants solve a specific problem you define.' },
                      { id:'OPEN_INNOVATION', title:'Open innovation', desc:'Participants bring their own ideas within your themes.' },
                    ].map(opt=>(
                      <button key={opt.id} onClick={()=>selectType(opt.id as 'PROBLEM_STATEMENT_BASED'|'OPEN_INNOVATION')} className={`text-left rounded-2xl border p-5 ${form.hackathonType===opt.id?'border-[#f26a4f] bg-[#fff6f3]':'border-[#e5e1d7] bg-white hover:border-[#f26a4f]/40'}`}>
                        <div className="font-bold">{opt.title}</div><p className="mt-1 text-xs leading-5 text-[#77798a]">{opt.desc}</p>
                        {form.hackathonType===opt.id && <span className="mt-3 inline-flex rounded-full bg-[#f26a4f] px-2 py-1 text-[10px] font-bold text-white">Selected</span>}
                      </button>
                    ))}
                  </div>
                  {form.hackathonType==='PROBLEM_STATEMENT_BASED' && !form.problemStatement.trim() && <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700 flex gap-2"><AlertTriangle size={14}/> Add a problem statement in Step 1 before confirming.</div>}
                </div>
              )}

              {current===3 && (
                <div className="space-y-5">
                  <h2 className="font-bold">Step 3 · Theme</h2>

                  <div className="rounded-xl bg-[#f4f1e8] p-4 space-y-3">
                    <div className="text-xs font-bold">Create new theme</div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input value={form.themeName} onChange={e=>update('themeName',e.target.value)} placeholder="e.g. Quantum Systems" className="hmt-input mt-0"/>
                      <input value={form.themeDesc} onChange={e=>update('themeDesc',e.target.value)} placeholder="Description" className="hmt-input mt-0"/>
                    </div>
                    <button onClick={createTheme} disabled={loading} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{loading?'Creating…':'Create theme'}</button>
                  </div>

                  <div className="flex gap-2">
                    <button onClick={async()=>{ setLoading(true); try{ await organizerApi.seedThemes(); const l=await organizerApi.listThemes(); setThemes(l); setSuccess('Default themes added.'); }catch(e:any){setError(e.message)} finally{setLoading(false)} }} className="rounded-xl border border-[#dedbd1] px-3 py-2 text-xs font-semibold">Add default themes</button>
                    <button onClick={async()=>{ const l=await organizerApi.listThemes(); setThemes(l); setSuccess(`${l.length} themes`)} } className="rounded-xl border border-[#dedbd1] px-3 py-2 text-xs font-semibold">Refresh</button>
                  </div>

                  <div className="grid gap-2 max-h-40 overflow-auto pr-1">
                    {themes.length ? themes.map((t:any)=><div key={t.id} className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs ${form.themeId===t.id?'border-[#f26a4f] bg-[#fff6f3]':'border-[#e5e1d7] bg-white'}`}><span><b>{t.name}</b> <span className="text-[#77798a]">{t.description?.slice(0,40)||''}</span></span><button onClick={()=>update('themeId',t.id)} className="rounded-lg bg-[#171a2d] px-2 py-1 text-[11px] font-bold text-white">{form.themeId===t.id?'Selected':'Select'}</button></div>) : <div className="text-xs text-[#77798a]">No themes yet. Create one or add the defaults.</div>}
                  </div>

                  {hackathonId ? (
                    <div className="flex gap-2">
                      <button onClick={assignTheme} disabled={!form.themeId || loading} className="rounded-xl bg-[#f26a4f] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Assign theme</button>
                      <span className="text-xs text-[#77798a] py-2">Assigned: {(hackathon?.themeIds?.length || form.assignedThemeIds.length || 0)} theme(s)</span>
                    </div>
                  ) : <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700">Create the hackathon in Step 1 first, then assign themes.</div>}
                </div>
              )}

              {current===4 && (
                <div className="space-y-5">
                  <h2 className="font-bold">Step 4 · Resources</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Title" required><input value={form.resourceTitle} onChange={e=>update('resourceTitle',e.target.value)} placeholder="Dataset Link" className="hmt-input mt-0"/></Field>
                    <Field label="Type"><select value={form.resourceType} onChange={e=>update('resourceType',e.target.value)} className="hmt-input mt-0"><option>DOCUMENT</option><option>LINK</option><option>API</option><option>DATASET</option><option>SDK</option><option>RULES</option><option>STARTER</option><option>OTHER</option></select></Field>
                    <Field label="URL"><input value={form.resourceUrl} onChange={e=>update('resourceUrl',e.target.value)} placeholder="https://example.com/data.csv" className="hmt-input mt-0"/></Field>
                    <Field label="Visibility"><select value={form.resourceVisibility} onChange={e=>update('resourceVisibility',e.target.value)} className="hmt-input mt-0"><option value="PUBLIC">Everyone</option><option value="PARTICIPANT">Participants</option><option value="MENTOR">Mentors</option><option value="ORGANIZER">Organizers only</option></select></Field>
                  </div>
                  <Field label="Content (for documents)"><textarea value={form.resourceContent} onChange={e=>update('resourceContent',e.target.value)} rows={2} className="hmt-input resize-none"/></Field>
                  <button onClick={addResource} disabled={loading} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Add resource</button>
                  <div className="space-y-2">
                    {resources.map((r:any)=><div key={r.id} className="flex items-center justify-between rounded-xl border border-[#e5e1d7] bg-white px-3 py-2 text-xs"><span><b>{r.title}</b> · {r.type} · <span className="rounded-full bg-[#f4f1e8] px-2 py-0.5 text-[10px] font-bold">{r.visibility}</span></span><span className="text-[#77798a]">{r.url?.slice(0,20)||'—'}</span></div>)}
                    {resources.length===0 && <div className="text-xs text-[#77798a]">No resources yet.</div>}
                  </div>
                </div>
              )}

              {current===5 && (
                <div className="space-y-5">
                  <h2 className="font-bold">Step 5 · Rules</h2>
                  <Field label="Rules (comma separated)"><textarea value={form.rulesList} onChange={e=>update('rulesList',e.target.value)} rows={3} placeholder="e.g. Teams of up to 4, Original work only" className="hmt-input resize-none"/></Field>
                  {hackathonId && <button onClick={async()=>{ setLoading(true); setError(null); try{ const updated=await organizerApi.updateHackathon(hackathonId,{ rules: form.rulesList.split(',').map(s=>s.trim()).filter(Boolean)}); setHackathon(updated); setSuccess('Rules saved.'); }catch(e:any){setError(e.message)} finally{setLoading(false)}}} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white">Save rules</button>}
                </div>
              )}

              {current===6 && (
                <div className="space-y-5">
                  <h2 className="font-bold">Step 6 · Timeline</h2>
                  <p className="text-sm text-[#77798a]">Phases can't overlap and must fit inside the event window.</p>
                  {phases.length === 0 && (
                    <div className="rounded-xl bg-[#f4f1e8] p-4 space-y-3">
                      <div className="text-xs font-bold">Event window {hackathon?.eventStart ? '(set)' : '(not set yet)'}</div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Event starts at (local)"><input type="datetime-local" value={form.eventStart} onChange={e=>update('eventStart',e.target.value)} className="hmt-input mt-0"/></Field>
                        <Field label="Event ends at (local)"><input type="datetime-local" value={form.eventEnd} onChange={e=>update('eventEnd',e.target.value)} className="hmt-input mt-0"/></Field>
                      </div>
                      <button onClick={materializeFromWindow} disabled={loading || !hackathonId} className="rounded-xl bg-[#5aafbd] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{loading ? 'Generating…' : 'Set window & generate timeline'}</button>
                      <p className="text-[11px] leading-4 text-[#77798a]">We'll suggest phases that fit this window. You can edit them afterwards.</p>
                    </div>
                  )}
                  <form onSubmit={addPhase} className="grid gap-3 sm:grid-cols-2">
                    <Field label="Name"><select value={form.phaseName} onChange={e=>update('phaseName',e.target.value)} className="hmt-input mt-0"><option>registration</option><option>team_formation</option><option>ideation</option><option>development</option><option>evaluation</option><option>submission</option><option>finale</option><option>results</option></select></Field>
                    <Field label="Order"><input type="number" min={1} step={1} value={form.phaseOrder} onChange={e=>{ orderTouchedRef.current = true; update('phaseOrder',Number(e.target.value)) }} className="hmt-input mt-0"/></Field>
                    <Field label="Starts at (local)"><input type="datetime-local" value={form.phaseStartsAt} onChange={e=>update('phaseStartsAt',e.target.value)} className="hmt-input mt-0"/></Field>
                    <Field label="Ends at (local)"><input type="datetime-local" value={form.phaseEndsAt} onChange={e=>update('phaseEndsAt',e.target.value)} className="hmt-input mt-0"/></Field>
                    <div className="sm:col-span-2"><Field label="Description"><input value={form.phaseDesc} onChange={e=>update('phaseDesc',e.target.value)} placeholder="Build & ship" className="hmt-input mt-0"/></Field></div>
                    <div className="sm:col-span-2"><button type="submit" disabled={loading} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{loading ? 'Adding…' : 'Add phase'}</button></div>
                  </form>
                  <div className="space-y-2">
                    {sortedPhases.map((p:any)=>(
                      editingId === p.id ? (
                        <form key={p.id} onSubmit={saveEdit} className="rounded-xl border border-[#f26a4f]/50 bg-white px-3 py-2 text-xs space-y-2">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <select value={editForm.name} onChange={e=>setEditForm(f=>({...f,name:e.target.value}))} className="hmt-input mt-0"><option>registration</option><option>team_formation</option><option>ideation</option><option>development</option><option>evaluation</option><option>submission</option><option>finale</option><option>results</option></select>
                            <input type="number" min={1} step={1} value={editForm.order} onChange={e=>setEditForm(f=>({...f,order:Number(e.target.value)}))} className="hmt-input mt-0"/>
                            <input type="datetime-local" value={editForm.startsAt} onChange={e=>setEditForm(f=>({...f,startsAt:e.target.value}))} className="hmt-input mt-0"/>
                            <input type="datetime-local" value={editForm.endsAt} onChange={e=>setEditForm(f=>({...f,endsAt:e.target.value}))} className="hmt-input mt-0"/>
                          </div>
                          <input value={editForm.description} onChange={e=>setEditForm(f=>({...f,description:e.target.value}))} placeholder="Description" className="hmt-input mt-0"/>
                          <div className="flex gap-2">
                            <button type="submit" disabled={loading} className="rounded-lg bg-[#171a2d] px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-50">{loading ? 'Saving…' : 'Save'}</button>
                            <button type="button" onClick={cancelEdit} disabled={loading} className="rounded-lg border border-[#dedbd1] px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-50">Cancel</button>
                          </div>
                        </form>
                      ) : (
                        <div key={p.id} className="flex justify-between rounded-xl border border-[#e5e1d7] bg-white px-3 py-2 text-xs"><span className="min-w-0"><b>#{p.order} {p.name}</b> · {new Date(p.startsAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} → {new Date(p.endsAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}{p.description ? <span className="block text-[#77798a] line-clamp-1">{p.description}</span> : null}</span><span className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${p.status==='ACTIVE'?'bg-[#d8e35b] text-[#171a2d]':'bg-[#f4f1e8]'}`}>{p.status}</span><button onClick={()=>startEdit(p)} disabled={loading} className="rounded-lg border border-[#dedbd1] px-2 py-1 text-[11px] font-bold hover:bg-[#f4f1e8] disabled:opacity-50">Edit</button><button onClick={()=>deletePhase(p.id, p.name)} disabled={loading} className="rounded-lg border border-[#dedbd1] px-2 py-1 text-[11px] font-bold text-[#d74635] hover:bg-[#f4f1e8] disabled:opacity-50">Delete</button></span></div>
                      )
                    ))}
                    {phases.length===0 && <div className="text-xs text-[#77798a]">No phases yet.</div>}
                  </div>
                </div>
              )}

              {current===7 && (
                <div className="space-y-5">
                  <h2 className="font-bold">Step 7 · Evaluation criteria</h2>
                  <p className="text-sm text-[#77798a]">Weights should add up to 1.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Name" required><input value={form.criteriaName} onChange={e=>update('criteriaName',e.target.value)} placeholder="Innovation" className="hmt-input mt-0"/></Field>
                    <Field label="Weight (0.01-1)"><input type="number" step="0.05" value={form.criteriaWeight} onChange={e=>update('criteriaWeight',e.target.value)} className="hmt-input mt-0"/></Field>
                    <Field label="Description"><input value={form.criteriaDesc} onChange={e=>update('criteriaDesc',e.target.value)} className="hmt-input mt-0"/></Field>
                    <Field label="Max score"><input type="number" value={form.criteriaMax} onChange={e=>update('criteriaMax',e.target.value)} className="hmt-input mt-0"/></Field>
                  </div>
                  <button onClick={addCriteria} disabled={loading} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Add criteria</button>
                  <div className="space-y-2">
                    {criteria.map((c:any)=><div key={c.id} className="flex justify-between rounded-xl border border-[#e5e1d7] bg-white px-3 py-2 text-xs"><span><b>{c.name}</b> · weight {c.weight} · max {c.maxScore}</span><button onClick={async()=>{ await organizerApi.deleteCriteria(c.id); setCriteria(prev=>prev.filter(x=>x.id!==c.id))}} className="text-[11px] font-bold text-[#f26a4f]">Remove</button></div>)}
                    {criteria.length===0 && <div className="text-xs text-[#77798a]">No criteria yet.</div>}
                  </div>
                </div>
              )}

              {current===8 && (
                <div className="space-y-5">
                  <h2 className="font-bold">Step 8 · Participation &amp; Submission</h2>
                  <p className="text-sm text-[#77798a]">How people take part and what they submit. Mentors are added later in the hackathon workspace.</p>

                  <Field label="Participation mode" required>
                    <select value={form.partMode} onChange={e=>update('partMode',e.target.value)} className="hmt-input mt-0">
                      <option value="BOTH">Both — individuals and teams</option>
                      <option value="TEAMS">Teams only</option>
                      <option value="INDIVIDUAL">Individuals only</option>
                    </select>
                  </Field>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Minimum team size" required={form.partMode!=='INDIVIDUAL'}>
                      <input type="number" min={1} max={20} step={1} value={form.partMin} disabled={form.partMode==='INDIVIDUAL'} onChange={e=>update('partMin',Number(e.target.value))} className="hmt-input mt-0"/>
                    </Field>
                    <Field label="Maximum team size" required={form.partMode!=='INDIVIDUAL'}>
                      <input type="number" min={1} max={20} step={1} value={form.partMax} disabled={form.partMode==='INDIVIDUAL'} onChange={e=>update('partMax',Number(e.target.value))} className="hmt-input mt-0"/>
                    </Field>
                  </div>

                  <Field label="Eligibility (leave empty for open to all)">
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {['Students','Developers','Designers','Professionals','Anyone'].map(opt=>(
                        <button key={opt} type="button" onClick={()=>update('partEligibility', form.partEligibility.includes(opt) ? form.partEligibility.filter(x=>x!==opt) : [...form.partEligibility, opt])} className={`rounded-full px-3 py-1.5 text-xs font-bold border ${form.partEligibility.includes(opt)?'bg-[#171a2d] text-white border-[#171a2d]':'bg-white border-[#e5e1d7] text-[#77798a] hover:border-[#171a2d]/40'}`}>{opt}</button>
                      ))}
                    </div>
                  </Field>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Registration approval" required>
                      <select value={form.partApproval} onChange={e=>update('partApproval',e.target.value)} className="hmt-input mt-0">
                        <option value="AUTOMATIC">Automatic</option>
                        <option value="ORGANIZER_APPROVAL">Organizer approval</option>
                      </select>
                    </Field>
                    <Field label="Maximum participants (empty = unlimited)">
                      <input type="number" min={1} step={1} value={form.partLimit} onChange={e=>update('partLimit',e.target.value)} placeholder="e.g. 500" className="hmt-input mt-0"/>
                    </Field>
                  </div>

                  <Field label="Submission requirements (select at least one)" required>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {[['TITLE','Project title'],['DESCRIPTION','Project description'],['REPO','GitHub repository'],['DEMO_URL','Demo URL'],['VIDEO','Demo/video'],['PRESENTATION','Presentation/PPT'],['DOCS','Documentation']].map(([v,label])=>(
                        <button key={v} type="button" onClick={()=>update('partRequired', form.partRequired.includes(v) ? form.partRequired.filter(x=>x!==v) : [...form.partRequired, v])} className={`rounded-full px-3 py-1.5 text-xs font-bold border ${form.partRequired.includes(v)?'bg-[#f26a4f] text-white border-[#f26a4f]':'bg-white border-[#e5e1d7] text-[#77798a] hover:border-[#f26a4f]/40'}`}>{label}</button>
                      ))}
                    </div>
                  </Field>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="flex items-center gap-2 rounded-xl border border-[#e5e1d7] bg-white px-3 py-2 text-xs font-semibold">
                      <input type="checkbox" checked={form.partTeamSubmission} disabled={form.partMode==='INDIVIDUAL'} onChange={e=>update('partTeamSubmission',e.target.checked)}/> Team submission
                    </label>
                    <label className="flex items-center gap-2 rounded-xl border border-[#e5e1d7] bg-white px-3 py-2 text-xs font-semibold">
                      <input type="checkbox" checked={form.partLateAllowed} onChange={e=>update('partLateAllowed',e.target.checked)}/> Late submissions allowed
                    </label>
                    <Field label="Max submissions (empty = unlimited)"><input type="number" min={1} step={1} value={form.partMaxSubs} onChange={e=>update('partMaxSubs',e.target.value)} placeholder="e.g. 3" className="hmt-input mt-0"/></Field>
                  </div>

                  <Field label="Is a GitHub repository URL required for each team?">
                    <select value={form.partRepoRequirement} onChange={e=>update('partRepoRequirement',e.target.value)} className="hmt-input mt-0">
                      <option value="OPTIONAL">Optional — teams may add one primary repo URL</option>
                      <option value="REQUIRED">Required — each team must provide one primary repo URL</option>
                      <option value="DISABLED">Not used — no repository URL field for this hackathon</option>
                    </select>
                    <span className="mt-1 block text-[11px] text-[#77798a]">One repository URL per team, set by the team leader.</span>
                  </Field>

                  <div className="rounded-xl bg-[#f4f1e8] p-3 text-xs leading-5 text-[#77798a]">
                    Submission deadline comes from the timeline (Step 6)
                    {(() => { const sub = phases.find((p:any)=>p.name==='submission'); return sub ? `: ${new Date(sub.endsAt).toLocaleDateString()} ${new Date(sub.endsAt).toLocaleTimeString()}` : ' — no submission phase configured yet'; })()}
                  </div>

                  <button onClick={saveParticipation} disabled={loading || !hackathonId} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{loading ? 'Saving…' : 'Save participation settings'}</button>
                  {!hackathonId && <div className="text-xs text-[#77798a]">Create the hackathon in Step 1 first.</div>}
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
                        <div className="mt-2 text-xs"><b>Type:</b> {hackathonTypeLabels[hackathon.hackathonType] ?? hackathon.hackathonType} · <b>Mode:</b> {hackathon.mode} · <b>Status:</b> <span className="rounded-full bg-[#d8e35b] px-2 py-1 text-[10px] font-bold">{hackathon.status}</span></div>
                        <div className="mt-2 text-xs">Rules: {hackathon.rules?.slice(0,3).join(', ') || '—'}</div>
                      </div>
                      {draft && <div className="rounded-xl border border-[#dedbd1] bg-white p-4"><div className="text-xs font-bold">AI draft</div><p className="mt-2 text-xs leading-5 text-[#77798a]">{draft.description?.slice(0,300) || JSON.stringify(draft).slice(0,300)}</p></div>}
                      <div className="grid gap-2 sm:grid-cols-3 text-xs">
                        <div className="rounded-xl bg-white border border-[#e5e1d7] p-3"><b>Themes</b><div className="mt-1 text-[#77798a]">{themes.length} available, {hackathon.themeIds?.length||0} assigned</div></div>
                        <div className="rounded-xl bg-white border border-[#e5e1d7] p-3"><b>Resources</b><div className="mt-1 text-[#77798a]">{resources.length} added</div></div>
                        <div className="rounded-xl bg-white border border-[#e5e1d7] p-3"><b>Timeline</b><div className="mt-1 text-[#77798a]">{phases.length} phases</div></div>
                        <div className="rounded-xl bg-white border border-[#e5e1d7] p-3"><b>Criteria</b><div className="mt-1 text-[#77798a]">{criteria.length} criteria · weights {Math.round(criteria.reduce((s:number,c:any)=>s+(Number(c.weight)||0),0)*100)}% / 100%</div></div>
                        <div className="rounded-xl bg-white border border-[#e5e1d7] p-3"><b>Participation</b><div className="mt-1 text-[#77798a]">{((hackathon as any)?.metadata?.draft?.participation) ? `Configured (${(hackathon as any).metadata.draft.participation.mode})` : 'Not configured'}</div>{((hackathon as any)?.metadata?.draft?.participation?.repoRequirement) && <div className="mt-1 text-[#77798a]">Repo URL: {(hackathon as any).metadata.draft.participation.repoRequirement}</div>}</div>
                        <div className="rounded-xl bg-white border border-[#e5e1d7] p-3"><b>Mentors</b><div className="mt-1 text-[#77798a]">{mentorAssignments.length} assigned</div></div>
                      </div>
                      {(() => {
                        const total = criteria.reduce((s:number,c:any)=>s+(Number(c.weight)||0),0);
                        const pct = Math.round(total*100);
                        if (criteria.length > 0 && Math.abs(total - 1) > 0.001) {
                          return <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700 flex gap-2"><AlertTriangle size={14} className="shrink-0"/> Evaluation weights: {pct}% / 100% — adjust criteria weights so they total exactly 100% before confirming.</div>;
                        }
                        return null;
                      })()}
                      {(() => {
                        const hours = parseDurationHours(hackathon.duration);
                        if (hours === null || phases.length === 0) return null;
                        const times = phases.map((p:any)=>new Date(p.startsAt).getTime()).concat(phases.map((p:any)=>new Date(p.endsAt).getTime())).filter(t=>!Number.isNaN(t));
                        if (times.length === 0) return null;
                        const spanHours = (Math.max(...times) - Math.min(...times)) / 3600000;
                        if (spanHours > hours * 2.5 || spanHours < hours * 0.4) {
                          return <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 flex gap-2"><AlertTriangle size={14} className="shrink-0"/> Timeline appears inconsistent with the configured hackathon duration. Please verify before publishing.</div>;
                        }
                        return null;
                      })()}
                    </div>
                  ) : <div className="text-sm text-[#77798a]">Create the hackathon in Step 1 first.</div>}
                </div>
              )}

              {current===10 && (
                <div className="space-y-5">
                  <h2 className="font-bold">Step 10 · Confirm &amp; Publish</h2>
                  <div className="rounded-xl bg-[#171a2d] p-4 text-[#fdfbf5]">
                    <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">Status</div>
                    <div className="mt-2 flex flex-wrap gap-1.5 items-center text-xs font-bold">
                      {['DRAFT','REVIEW','CONFIRMED','PUBLISHED'].map(s=> <span key={s} className={`rounded-full px-2.5 py-1 ${hackathon?.status===s?'bg-[#d8e35b] text-[#171a2d]':'bg-[#2a2e45] text-[#9b9fb1]'}`}>{s}</span>)}
                    </div>
                    <p className="mt-3 text-xs leading-5 text-[#b9bdca]">Send to review, confirm, then publish. Publishing makes the hackathon visible to participants.</p>
                  </div>

                  {!hackathonId ? <div className="text-sm text-[#77798a]">Create the hackathon in Step 1 first.</div> : (
                    <div className="grid gap-2">
                      <div className="grid gap-2 sm:grid-cols-3">
                        <button onClick={()=>transition('review')} disabled={loading || hackathon?.status!=='DRAFT'} className="rounded-xl bg-[#5aafbd] px-3 py-3 text-xs font-bold text-white disabled:opacity-40">Send to review</button>
                        <button onClick={()=>transition('confirm')} disabled={loading || hackathon?.status!=='REVIEW'} className="rounded-xl bg-[#f26a4f] px-3 py-3 text-xs font-bold text-white disabled:opacity-40">Confirm</button>
                        <button onClick={()=>transition('publish')} disabled={loading || hackathon?.status!=='CONFIRMED'} className="rounded-xl bg-[#d8e35b] px-3 py-3 text-xs font-bold text-[#171a2d] disabled:opacity-40">Publish</button>
                      </div>
                      {hackathon?.status==='PUBLISHED' && <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-700 flex gap-2"><CheckCircle2 size={14}/> Published! <Link href={`/organizer/hackathons/${hackathonId}`} className="font-bold underline">View workspace</Link></div>}
                    </div>
                  )}
                </div>
              )}

            </motion.div>
          </AnimatePresence>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl bg-[#171a2d] p-6 text-[#fdfbf5]">
            <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">Progress</div>
            <div className="mt-3 text-2xl font-bold">{current}/10</div>
            <div className="mt-2 h-2 rounded-full bg-[#2a2e45]"><div className="h-full rounded-full bg-[#d8e35b] transition-all" style={{width:`${current*10}%`}}/></div>
            <div className="mt-3 space-y-1.5">
              {steps.map(s=> <div key={s.id} className={`flex items-center gap-2 text-xs ${s.id===current?'text-white font-bold': s.id<current?'text-[#9b9fb1]':'text-[#77798a]'}`}><span className={`h-1.5 w-1.5 rounded-full ${s.id<current?'bg-[#5aafbd]': s.id===current?'bg-[#d8e35b]':'bg-[#3a3e5a]'}`}/>{s.label}</div>)}
            </div>
            {hackathonId && <div className="mt-4 rounded-xl bg-[#252941] p-3 text-xs"><div className="text-[#9b9fb1]">Hackathon</div><div className="mt-1 font-bold">{hackathon?.title}</div></div>}
          </div>

          <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5">
            <h3 className="font-bold text-sm">Actions</h3>
            <div className="mt-3 space-y-2">
              {current===1 && (
                <>
                  <button onClick={handleGenerateDraft} disabled={loading || !canNext()} className="w-full rounded-xl bg-[#f26a4f] px-3 py-3 text-xs font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2">{loading ? <Loader2 size={14} className="animate-spin"/> : <Sparkles size={14}/>} {loading ? 'Generating…' : 'Generate with AI'}</button>
                  <button onClick={handleManualCreate} disabled={loading || !canNext()} className="w-full rounded-xl border border-[#dedbd1] px-3 py-3 text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-2">{loading ? <Loader2 size={14} className="animate-spin"/> : null} {loading ? 'Creating…' : 'Start from scratch'}</button>
                  <p className="text-[11px] leading-4 text-[#77798a]">Either way it stays a draft until you publish.</p>
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
        </div>
      </div>

      <div className="flex justify-between">
        <Link href="/organizer/dashboard" className="text-xs font-bold text-[#77798a] flex items-center gap-1"><ArrowLeft size={14}/> Dashboard</Link>
        <button onClick={()=> setLocation('/organizer/hackathons')} className="text-xs font-bold text-[#f26a4f] flex items-center gap-1">View all hackathons <ArrowRight size={14}/></button>
      </div>
    </div>
  )
}
