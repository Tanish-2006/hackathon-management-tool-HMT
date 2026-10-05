import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight, ExternalLink, Loader2, ShieldCheck, Sparkles, Info, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { organizerApi, OrganizerApiError, ORGANIZER_ACCESS_KEY, ORGANIZER_REFRESH_KEY } from '@/services/organizerApi';

const steps = [
  { id:1, label:'Basic info', desc:'Title, objective, audience, duration, mode' },
  { id:2, label:'Type', desc:'Problem Statement vs Open Innovation' },
  { id:3, label:'Theme', desc:'Create or assign themes' },
  { id:4, label:'Resources', desc:'Visibility-scoped resources' },
  { id:5, label:'Rules', desc:'Constraints & rules' },
  { id:6, label:'Timeline', desc:'Phases with start/end' },
  { id:7, label:'Evaluation', desc:'Criteria & weights' },
  { id:8, label:'Participation', desc:'Participation & submission setup' },
  { id:9, label:'Review', desc:'Human review gate' },
  { id:10, label:'Confirm', desc:'DRAFT→REVIEW→CONFIRMED→PUBLISHED' },
];

function Field({label,required,error,children}:{label:string;required?:boolean;error?:string;children:React.ReactNode}){
  return <label className="block text-sm font-semibold">{label}{required && <span className="ml-1 text-[#f26a4f]">*</span>}<div className="mt-1.5">{children}</div>{error && <span className="mt-1 block text-xs font-normal text-[#d74635]">{error}</span>}</label>
}

// Heuristic: parse freeform duration ("3 days", "48-hour", "2 weeks") to hours.
// Returns null when unparseable — callers treat that as "no opinion".
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
    // Step 8 Participation & Submission (persisted via PATCH participation).
    partMode:'BOTH' as 'INDIVIDUAL'|'TEAMS'|'BOTH',
    partMin:2, partMax:4,
    partEligibility:[] as string[],
    partApproval:'AUTOMATIC' as 'AUTOMATIC'|'ORGANIZER_APPROVAL',
    partLimit:'' as string,
    partRequired:['TITLE','DESCRIPTION'] as string[],
    partTeamSubmission:true, partLateAllowed:false,
    partMaxSubs:'' as string,
  });
  const [themes, setThemes] = useState<any[]>([]);
  const [resources, setResources] = useState<any[]>([]);
  const [phases, setPhases] = useState<any[]>([]);
  const [criteria, setCriteria] = useState<any[]>([]);
  const [mentorAssignments, setMentorAssignments] = useState<any[]>([]);
  // True when the session is dead (refresh failed): banner offers sign-in again.
  // Wizard state (sessionStorage) is preserved, so nothing is lost.
  const [authExpired, setAuthExpired] = useState(false);
  // Per-phase inline editor state (Step 6). Loads the EXACT stored phase —
  // name, order, dates and description — so Save writes back complete data.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: 'registration', order: 1, startsAt: '', endsAt: '', description: '' });
  // Tracks manual order edits so auto-order never fights the organizer.
  const orderTouchedRef = useRef(false);
  // Prefill Step 8 from saved config once per hackathon (never overwrites edits).
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
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hackathon, hackathonId]);

  // Re-entrancy guard: prevents duplicate hackathons from repeated clicks
  // (state updates are async, so `loading` alone cannot cover double-clicks).
  const busyRef = useRef(false);

  // Step 1 state survives in-wizard back navigation (component state) and
  // browser refresh (sessionStorage). Restoring never creates a hackathon —
  // creation happens only via the Step 1 buttons below.
  const WIZARD_KEY = 'hmt-hackathon-wizard';
  // The organizer API stores data in memory: a server restart wipes hackathons
  // while this tab still holds the old ID. A restored ID is therefore verified
  // against the server — a dead ID is discarded instead of failing every step.
  const STALE_MSG = 'Hackathon not found on the server. The development server was likely restarted (stored data is in-memory). Recreate your hackathon from Step 1 — nothing was duplicated or deleted.';
  function resetStaleHackathon() {
    setHackathonId(null); setHackathon(null); setDraft(null);
    setPhases([]); setResources([]); setCriteria([]); setMentorAssignments([]);
    setEditingId(null);
    try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(WIZARD_KEY); } catch { /* ignore */ }
  }
  // True when the backend reports the wizard's hackathon as gone (404).
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
          // Only discard on a definitive 404; network blips keep local state.
          if (isMissingHackathon(e)) { resetStaleHackathon(); setCurrent(1); setError(STALE_MSG); }
          else { setHackathonId(id); }
        });
      }
    } catch { /* corrupted storage: start fresh */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      if (typeof sessionStorage === 'undefined') return;
      sessionStorage.setItem(WIZARD_KEY, JSON.stringify({ form, hackathonId, current }));
    } catch { /* storage unavailable: wizard still works for this session */ }
  }, [form, hackathonId, current]);

  const update = (k:string,v:any)=> setForm(f=>({...f,[k]:v}));

  // Next available order: max(existing)+1, or 1 when empty. Auto-applied only
  // until the organizer edits the field manually; backend still enforces
  // positive/unique/increasing + no-overlap as the final authority.
  function nextPhaseOrder(list: any[]): number {
    let max = 0;
    for (const p of list) {
      const o = Number(p?.order);
      if (Number.isInteger(o) && o > max) max = o;
    }
    return max + 1;
  }
  useEffect(() => {
    if (!orderTouchedRef.current) update('phaseOrder', nextPhaseOrder(phases));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phases]);

  // Maps raw API failures to organizer-friendly messages. Overlap rejections
  // name the existing phase the new dates collide with, instead of a bare
  // "between order X and Y".
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

  // ISO → datetime-local value (local time).
  function toLocalInput(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

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

  // Required Step 1 fields (mirrors canNext so the message names every gap).
  function step1Missing(): string[] {
    const missing: string[] = [];
    if (!form.title.trim()) missing.push('Event title');
    if (!form.description.trim()) missing.push('Description');
    if (!form.objective.trim()) missing.push('Objective');
    if (!form.audience.trim()) missing.push('Audience');
    return missing;
  }

  // AI draft endpoint additionally requires these Step 1 inputs (draftInputSchema).
  function aiMissing(): string[] {
    const missing = step1Missing();
    if (!form.themePreference.trim()) missing.push('Theme preference');
    if (!form.expectedOutcomes.trim()) missing.push('Expected outcomes');
    if (!form.judgingPreferences.trim()) missing.push('Judging preferences');
    if (!form.resources.trim()) missing.push('Resources');
    if (!form.rules.trim()) missing.push('Rules');
    return missing;
  }

  async function handleGenerateDraft(){
    if (busyRef.current || loading) return;
    const missing = aiMissing();
    if (missing.length) { setError(`Please fill in: ${missing.join(', ')}.`); return; }
    // Never create a second hackathon: an existing draft is continued, not duplicated.
    if (hackathonId) {
      setError(null);
      setSuccess(`Continuing with existing draft ${hackathonId.slice(0,8)} — no duplicate created.`);
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
      setSuccess(`Draft generated — status DRAFT (never auto-published). Id ${res.hackathon.id.slice(0,8)}`);
      setCurrent(2);
    }catch(e:any){
      setError(e instanceof OrganizerApiError ? e.message : (e.message || 'Generate failed'));
    } finally{ setLoading(false); busyRef.current = false; }
  }

  async function handleManualCreate(){
    if (busyRef.current || loading) return;
    const missing = step1Missing();
    if (missing.length) { setError(`Please fill in: ${missing.join(', ')}.`); return; }
    // Never create a second hackathon: an existing draft is continued, not duplicated.
    if (hackathonId) {
      setError(null);
      setSuccess(`Continuing with existing draft ${hackathonId.slice(0,8)} — no duplicate created.`);
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
      setSuccess(`Manual hackathon created — DRAFT ${h.id.slice(0,8)}`);
      setCurrent(2);
    }catch(e:any){ setError(e.message || 'Create failed') } finally{ setLoading(false); busyRef.current = false; }
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
  async function addPhase(e?: React.FormEvent){
    // Real form submission: never reload the page on submit.
    e?.preventDefault();
    if (busyRef.current || loading) return;
    if(!hackathonId){ setError('Create hackathon first'); return }
    if(!form.phaseStartsAt || !form.phaseEndsAt){ setError('Start and end required (ISO datetime)'); return }
    const startMs = new Date(form.phaseStartsAt).getTime();
    const endMs = new Date(form.phaseEndsAt).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) { setError('Unable to create phase: Invalid start/end time.'); return; }
    if (startMs >= endMs) { setError('Unable to create phase: start must be before end.'); return; }
    busyRef.current = true;
    setLoading(true); setError(null); setAuthExpired(false);
    try{
      const p = await organizerApi.createPhase(hackathonId, { name: form.phaseName, order: Number(form.phaseOrder), startsAt: new Date(startMs).toISOString(), endsAt: new Date(endMs).toISOString(), description: form.phaseDesc });
      // Functional update (no stale state): list shows #1, #2… immediately.
      setPhases(prev=>[...prev, p]);
      setSuccess(`Phase "${p.name}" created`);
      // Prepare the next phase: bump order, clear dates/description.
      // Name stays user-controlled (never forced); failed requests keep the form.
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
  async function seedDemoMentor(){
    // No dedicated backend seeder exists: reuse the existing registration
    // endpoint with role MENTOR (the same call real mentor signup uses).
    // The UUID below always comes from the backend response — never hardcoded.
    // NOTE: kept for API-level reuse; the Step 8 wizard UI no longer assigns
    // mentors (managed in the workspace). organizerApi.register is still the
    // supported path for creating mentor accounts.
    if (busyRef.current || loading) return;
    if(!hackathonId){ setError('Create hackathon first'); return }
    busyRef.current = true;
    setLoading(true); setError(null); setAuthExpired(false);
    try{
      // organizerApi.register stores the new account's tokens: snapshot the
      // organizer session first so seeding never hijacks it (the next organizer
      // call would otherwise run as the demo mentor and get 403).
      const prevAccess = typeof window !== 'undefined' ? localStorage.getItem(ORGANIZER_ACCESS_KEY) : null;
      const prevRefresh = typeof window !== 'undefined' ? localStorage.getItem(ORGANIZER_REFRESH_KEY) : null;
      const stamp = String(Date.now());
      const reg: any = await organizerApi.register({
        email: `demo.mentor.${stamp}@example.com`,
        password: 'DemoPass123!',
        fullName: 'Demo Mentor',
        displayName: 'Demo Mentor',
        role: 'MENTOR',
        phoneNumber: `+1${stamp.slice(-10)}`,
      });
      if (typeof window !== 'undefined') {
        if (prevAccess) localStorage.setItem(ORGANIZER_ACCESS_KEY, prevAccess); else localStorage.removeItem(ORGANIZER_ACCESS_KEY);
        if (prevRefresh) localStorage.setItem(ORGANIZER_REFRESH_KEY, prevRefresh); else localStorage.removeItem(ORGANIZER_REFRESH_KEY);
      }
      const id = reg?.user?.id;
      if (!id) throw new Error('Demo mentor registration did not return a user ID.');
      setSuccess('Demo mentor created successfully.');
      return id;
    }catch(err:any){
      if (isMissingHackathon(err)) { resetStaleHackathon(); setCurrent(1); setError(STALE_MSG); }
      else if (!markAuthError(err)) setError(`Unable to seed demo mentor: ${err?.message || 'request failed'}`);
      else setError('Your session has expired. Please log in again.');
      return null;
    } finally{ setLoading(false); busyRef.current = false; }
  }
  // Step 8 Participation & Submission: validate client-side (mirrors server
  // rules), persist via PATCH participation, refresh the hackathon record.
  async function saveParticipation(){
    if (busyRef.current || loading) return;
    if(!hackathonId){ setError('Create hackathon first'); return }
    const teamsOn = form.partMode !== 'INDIVIDUAL';
    const min = Number(form.partMin);
    const max = Number(form.partMax);
    if (!teamsOn && (form.partMin !== '' as any && form.partMin !== null)) {
      // Individual-only must not carry a team size (server enforces the same).
    }
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
      setSuccess('Participation & submission settings saved.');
    }catch(err:any){
      if (isMissingHackathon(err)) { resetStaleHackathon(); setCurrent(1); setError(STALE_MSG); }
      else if (!markAuthError(err)) setError(`Unable to save participation settings: ${err?.message || 'request failed'}`);
      else setError('Your session has expired. Please log in again.');
    } finally{ setLoading(false); busyRef.current = false; }
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
                    <Field label="Event title" required><input value={form.title} onChange={e=>update('title',e.target.value)} placeholder="e.g. Orbit / 26 — AI Climate" className="hmt-input" data-testid="input-title"/></Field>
                    <Field label="Duration" required><input value={form.duration} onChange={e=>update('duration',e.target.value)} placeholder="3 days" className="hmt-input"/></Field>
                    <Field label="Mode" required><select value={form.mode} onChange={e=>update('mode',e.target.value)} className="hmt-input"><option>ONLINE</option><option>OFFLINE</option><option>HYBRID</option></select></Field>
                    <Field label="Audience" required><input value={form.audience} onChange={e=>update('audience',e.target.value)} placeholder="Students, researchers…" className="hmt-input"/></Field>
                  </div>
                  <Field label="Description" required><textarea value={form.description} onChange={e=>update('description',e.target.value)} rows={3} placeholder="What should builders make and why now?" className="hmt-input resize-none"/></Field>
                  <Field label="Objective"><input value={form.objective} onChange={e=>update('objective',e.target.value)} className="hmt-input"/></Field>
                  <Field label="Problem statement (for PROBLEM_STATEMENT_BASED)"><textarea value={form.problemStatement} onChange={e=>update('problemStatement',e.target.value)} rows={2} className="hmt-input resize-none" placeholder="Solve water scarcity with AI…"/></Field>

                  <div className="rounded-xl bg-[#fff8e6] border border-amber-200 p-3 flex gap-2 text-xs leading-5"><Info size={14} className="text-amber-600 shrink-0 mt-0.5"/><span><b>AI drafting:</b> The information above helps AI generate your hackathon draft. AI-generated content is always saved as a draft and will never be published automatically. You can review and edit everything before publishing.</span></div>
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
                <form onSubmit={addPhase} className="space-y-5">
                  <h2 className="font-bold">Step 6 · Timeline</h2>
                  <p className="text-sm text-[#77798a]">POST /hackathons/:id/phases — must not overlap, start &lt; end, sequential order.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Name"><select value={form.phaseName} onChange={e=>update('phaseName',e.target.value)} className="hmt-input mt-0"><option>registration</option><option>team_formation</option><option>ideation</option><option>development</option><option>evaluation</option><option>submission</option><option>finale</option><option>results</option></select></Field>
                    <Field label="Order"><input type="number" min={1} step={1} value={form.phaseOrder} onChange={e=>{ orderTouchedRef.current = true; update('phaseOrder',Number(e.target.value)) }} className="hmt-input mt-0"/></Field>
                    <Field label="Starts at (local)"><input type="datetime-local" value={form.phaseStartsAt} onChange={e=>update('phaseStartsAt',e.target.value)} className="hmt-input mt-0"/></Field>
                    <Field label="Ends at (local)"><input type="datetime-local" value={form.phaseEndsAt} onChange={e=>update('phaseEndsAt',e.target.value)} className="hmt-input mt-0"/></Field>
                  </div>
                  <Field label="Description"><input value={form.phaseDesc} onChange={e=>update('phaseDesc',e.target.value)} placeholder="Build & ship" className="hmt-input mt-0"/></Field>
                  <button type="submit" disabled={loading} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{loading ? 'Adding…' : 'Add phase'}</button>
                  <div className="space-y-2">
                    {phases.map((p:any)=>(
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
                        <div key={p.id} className="flex justify-between rounded-xl border border-[#e5e1d7] bg-white px-3 py-2 text-xs"><span><b>#{p.order} {p.name}</b> · {new Date(p.startsAt).toLocaleDateString()} → {new Date(p.endsAt).toLocaleDateString()}</span><span className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${p.status==='ACTIVE'?'bg-[#d8e35b] text-[#171a2d]':'bg-[#f4f1e8]'}`}>{p.status}</span><button onClick={()=>startEdit(p)} disabled={loading} className="rounded-lg border border-[#dedbd1] px-2 py-1 text-[11px] font-bold hover:bg-[#f4f1e8] disabled:opacity-50">Edit</button><button onClick={()=>deletePhase(p.id, p.name)} disabled={loading} className="rounded-lg border border-[#dedbd1] px-2 py-1 text-[11px] font-bold text-[#d74635] hover:bg-[#f4f1e8] disabled:opacity-50">Delete</button></span></div>
                      )
                    ))}
                    {phases.length===0 && <div className="text-xs text-[#77798a]">No phases yet. Add registration → results.</div>}
                  </div>
                </form>
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
                  <h2 className="font-bold">Step 8 · Participation &amp; Submission</h2>
                  <p className="text-sm text-[#77798a]">Configure how people participate and what they must submit. Saved via PATCH /hackathons/:id. Mentors are managed separately in the workspace after creation.</p>

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

                  <div className="rounded-xl bg-[#f4f1e8] p-3 text-xs leading-5 text-[#77798a]">
                    Submission deadline comes from the timeline (Step 6)
                    {(() => { const sub = phases.find((p:any)=>p.name==='submission'); return sub ? `: ${new Date(sub.endsAt).toLocaleDateString()} ${new Date(sub.endsAt).toLocaleTimeString()}` : ' — no submission phase configured yet'; })()}
                  </div>

                  <button onClick={saveParticipation} disabled={loading || !hackathonId} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{loading ? 'Saving…' : 'Save participation settings'}</button>
                  {!hackathonId && <div className="text-xs text-[#77798a]">Create hackathon first (Step 1), then save participation settings.</div>}
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
                        <div className="rounded-xl bg-white border border-[#e5e1d7] p-3"><b>Criteria</b><div className="mt-1 text-[#77798a]">{criteria.length} criteria · weights {Math.round(criteria.reduce((s:number,c:any)=>s+(Number(c.weight)||0),0)*100)}% / 100%</div></div>
                        <div className="rounded-xl bg-white border border-[#e5e1d7] p-3"><b>Participation</b><div className="mt-1 text-[#77798a]">{((hackathon as any)?.metadata?.draft?.participation) ? `Configured (${(hackathon as any).metadata.draft.participation.mode})` : 'Not configured'}</div></div>
                        <div className="rounded-xl bg-white border border-[#e5e1d7] p-3"><b>Mentors</b><div className="mt-1 text-[#77798a]">{mentorAssignments.length} assignments (optional, managed in workspace)</div></div>
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
                      <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 flex gap-2"><AlertTriangle size={14} className="shrink-0"/> Human review required: please verify every AI-generated field before confirming.</div>
                    </div>
                  ) : <div className="text-sm text-[#77798a]">No hackathon yet — generate draft or create manually in Step 1.</div>}
                </div>
              )}

              {current===10 && (
                <div className="space-y-5">
                  <h2 className="font-bold">Step 10 · Confirm &amp; Publish</h2>
                  <div className="rounded-xl bg-[#171a2d] p-4 text-[#fdfbf5]">
                    <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">State machine</div>
                    <div className="mt-2 flex flex-wrap gap-1.5 items-center text-xs font-bold">
                      {['DRAFT','REVIEW','CONFIRMED','PUBLISHED'].map(s=> <span key={s} className={`rounded-full px-2.5 py-1 ${hackathon?.status===s?'bg-[#d8e35b] text-[#171a2d]':'bg-[#2a2e45] text-[#9b9fb1]'}`}>{s}</span>)}
                    </div>
                    <p className="mt-3 text-xs leading-5 text-[#b9bdca]">Allowed: DRAFT→REVIEW→CONFIRMED→PUBLISHED. <b className="text-[#f26a4f]">Direct DRAFT→PUBLISHED is blocked (400).</b> AI content never auto-publishes. Publishing makes this hackathon available to participants. Archiving is a separate administrative action in the workspace.</p>
                  </div>

                  {!hackathonId ? <div className="text-sm text-[#77798a]">Create hackathon first.</div> : (
                    <div className="grid gap-2">
                      <div className="grid gap-2 sm:grid-cols-3">
                        <button onClick={()=>transition('review')} disabled={loading || hackathon?.status!=='DRAFT'} className="rounded-xl bg-[#5aafbd] px-3 py-3 text-xs font-bold text-white disabled:opacity-40">→ REVIEW</button>
                        <button onClick={()=>transition('confirm')} disabled={loading || hackathon?.status!=='REVIEW'} className="rounded-xl bg-[#f26a4f] px-3 py-3 text-xs font-bold text-white disabled:opacity-40">→ CONFIRMED</button>
                        <button onClick={()=>transition('publish')} disabled={loading || hackathon?.status!=='CONFIRMED'} className="rounded-xl bg-[#d8e35b] px-3 py-3 text-xs font-bold text-[#171a2d] disabled:opacity-40">→ PUBLISHED</button>
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
                  <button onClick={handleGenerateDraft} disabled={loading || !canNext()} className="w-full rounded-xl bg-[#f26a4f] px-3 py-3 text-xs font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2">{loading ? <Loader2 size={14} className="animate-spin"/> : <Sparkles size={14}/>} {loading ? 'Generating draft…' : 'Generate AI draft (DRAFT)'}</button>
                  <button onClick={handleManualCreate} disabled={loading || !canNext()} className="w-full rounded-xl border border-[#dedbd1] px-3 py-3 text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-2">{loading ? <Loader2 size={14} className="animate-spin"/> : null} {loading ? 'Creating…' : 'Create manually (DRAFT)'}</button>
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
            <p className="text-xs leading-5 text-amber-800"><b>Publishing protection:</b> AI-generated hackathons are never published automatically. Every draft must be reviewed and explicitly confirmed before it can be published.</p>
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
