import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { User, Mail, ShieldCheck, Save, Loader2, AlertCircle, Check, X, Sparkles, Eye, EyeOff, Github } from 'lucide-react';
import { hmtBackendService, ApiError } from '@/services/backendApi';
import { Link } from 'wouter';

function friendly(e:unknown){ return e instanceof ApiError? e.message: (e as Error)?.message || 'Failed' }

export default function ParticipantProfile(){
  const [profile,setProfile]=useState<any>(null);
  const [user,setUser]=useState<any>(null);
  const [skillProfile,setSkillProfile]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [success,setSuccess]=useState<string|null>(null);
  const [form,setForm]=useState({ fullName:'', bio:'', skills:'', visibility:'PUBLIC_PROFILE' });
  const [skillForm,setSkillForm]=useState({ programmingLanguages:'', frameworks:'', interests:'', availability:'FULL_TIME', experienceLevel:'INTERMEDIATE', visibility:'TEAM_DISCOVERABLE' });

  useEffect(()=>{
    let m=true;
    async function load(){
      setLoading(true); setError(null);
      try{
        const [me, prof, sp] = await Promise.allSettled([
          hmtBackendService.getMe(),
          hmtBackendService.getProfile(),
          hmtBackendService.getSkillProfile(),
        ]);
        if(!m) return;
        if(me.status==='fulfilled'){ const u:any=me.value; setUser(u?.user || u); }
        if(prof.status==='fulfilled'){ const p:any=prof.value; const data = p?.profile || p; setProfile(data); if(data){ setForm({ fullName: data.fullName || data.user?.fullName || '', bio: data.bio || '', skills: (data.skills||[]).join(', '), visibility: data.visibility || 'PUBLIC_PROFILE' }); } }
        if(sp.status==='fulfilled' && sp.value){ const s:any=sp.value; const data = s?.skillProfile || s; if(data && data.userId){ setSkillProfile(data); setSkillForm({ programmingLanguages: (data.programmingLanguages||[]).join(', '), frameworks: (data.frameworks||[]).join(', '), interests: (data.interests||[]).join(', '), availability: data.availability || 'FULL_TIME', experienceLevel: data.experienceLevel || 'INTERMEDIATE', visibility: data.visibility || 'TEAM_DISCOVERABLE' }); } }
      }catch(e){ if(m) setError(friendly(e)); }
      finally{ if(m) setLoading(false); }
    }
    load(); return ()=>{m=false}
  },[]);

  async function saveProfile(e: React.FormEvent){
    e.preventDefault(); setSaving(true); setError(null); setSuccess(null);
    try{
      const payload:any = { fullName: form.fullName || undefined, bio: form.bio, skills: form.skills.split(',').map(s=>s.trim()).filter(Boolean), visibility: form.visibility };
      const res = await hmtBackendService.updateProfile(payload);
      setProfile(res); setSuccess('Profile updated');
    }catch(e){ setError(friendly(e)); }
    finally{ setSaving(false); }
  }
  async function saveSkill(e: React.FormEvent){
    e.preventDefault(); setSaving(true); setError(null);
    try{
      const payload:any = {
        programmingLanguages: skillForm.programmingLanguages.split(',').map(s=>s.trim()).filter(Boolean),
        frameworks: skillForm.frameworks.split(',').map(s=>s.trim()).filter(Boolean),
        interests: skillForm.interests.split(',').map(s=>s.trim()).filter(Boolean),
        availability: skillForm.availability,
        experienceLevel: skillForm.experienceLevel,
        visibility: skillForm.visibility,
      };
      const res = await hmtBackendService.upsertSkillProfile(payload);
      setSkillProfile(res); setSuccess('Skill profile saved — discoverability updated');
    }catch(e){ setError(friendly(e)); }
    finally{ setSaving(false); }
  }

  if(loading) return <div className="space-y-4"><div className="h-24 animate-pulse rounded-2xl bg-[#e9e5da]"/><div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/></div>

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">Profile · visibility-aware</div>
          <h1 className="mt-2 text-3xl font-bold tracking-[-.05em] text-[#171a2d]">Shape how teams find you.</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#77798a]">Your profile and skill visibility control discovery and matching. Only TEAM_DISCOVERABLE surfaces you in partner flows.</p>
        </div>
        <span className="rounded-full bg-[#171a2d] px-3 py-1.5 text-xs font-bold text-white">{user?.role ?? user?.user?.role ?? '—'}</span>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex gap-2"><AlertCircle size={16}/>{error}<button onClick={()=>setError(null)} className="ml-auto"><X size={14}/></button></div>}
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 flex gap-2"><Check size={16}/>{success}<button onClick={()=>setSuccess(null)} className="ml-auto"><X size={14}/></button></div>}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
          <h3 className="font-bold flex items-center gap-2"><User size={16}/> Profile</h3>
          <form onSubmit={saveProfile} className="mt-4 space-y-4">
            <div className="flex items-center gap-4">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#f26a4f] text-lg font-bold text-white">{(user?.fullName || form.fullName || 'P').slice(0,2).toUpperCase()}</div>
              <div><div className="text-sm font-bold">{user?.fullName || form.fullName || 'Participant'}</div><div className="text-xs text-[#77798a] flex items-center gap-1"><Mail size={12}/>{user?.email || 'email hidden'}</div></div>
              <span className="ml-auto rounded-full bg-[#f4f1e8] px-2 py-1 text-[11px] font-bold">{profile?.visibility || form.visibility}</span>
            </div>

            <label className="block text-xs font-semibold">Full name<input value={form.fullName} onChange={e=>setForm(f=>({...f,fullName:e.target.value}))} placeholder="Your full name" className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm outline-none focus:border-[#f26a4f]"/></label>
            <label className="block text-xs font-semibold">Bio<textarea value={form.bio} onChange={e=>setForm(f=>({...f,bio:e.target.value}))} rows={3} placeholder="Builder, systems thinker, loves shipping." className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm outline-none focus:border-[#f26a4f]"/></label>
            <label className="block text-xs font-semibold">Skills (comma separated)<input value={form.skills} onChange={e=>setForm(f=>({...f,skills:e.target.value}))} placeholder="React, Node, Python, Neo4j" className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm outline-none focus:border-[#f26a4f]"/></label>
            <label className="block text-xs font-semibold">Visibility<select value={form.visibility} onChange={e=>setForm(f=>({...f,visibility:e.target.value}))} className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm"><option value="PUBLIC_PROFILE">PUBLIC_PROFILE</option><option value="TEAM_DISCOVERABLE">TEAM_DISCOVERABLE</option><option value="PRIVATE">PRIVATE</option><option value="ORGANIZER_ONLY">ORGANIZER_ONLY</option></select><span className="mt-1 block text-[11px] text-[#77798a]">Controls who sees your profile fields.</span></label>

            <button disabled={saving} className="w-full rounded-xl bg-[#171a2d] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50 inline-flex items-center justify-center gap-2">{saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>} Save profile</button>
          </form>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
            <h3 className="font-bold flex items-center gap-2"><Sparkles size={16} className="text-[#5aafbd]"/> Skill matching</h3>
            <p className="mt-1 text-xs text-[#77798a]">This powers <Link href="/participant/teams" className="underline font-bold text-[#171a2d]">Teams → skill matching</Link>. Set visibility to TEAM_DISCOVERABLE to be matched.</p>
            <form onSubmit={saveSkill} className="mt-4 space-y-3">
              <label className="block text-xs font-semibold">Programming languages<input value={skillForm.programmingLanguages} onChange={e=>setSkillForm(f=>({...f,programmingLanguages:e.target.value}))} placeholder="TypeScript, Python, Rust" className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm"/></label>
              <label className="block text-xs font-semibold">Frameworks<input value={skillForm.frameworks} onChange={e=>setSkillForm(f=>({...f,frameworks:e.target.value}))} placeholder="React, Fastify, Next.js" className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm"/></label>
              <label className="block text-xs font-semibold">Interests<input value={skillForm.interests} onChange={e=>setSkillForm(f=>({...f,interests:e.target.value}))} placeholder="AI, Web, Climate" className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm"/></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-semibold">Availability<select value={skillForm.availability} onChange={e=>setSkillForm(f=>({...f,availability:e.target.value}))} className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm"><option>FULL_TIME</option><option>PART_TIME</option><option>WEEKENDS</option></select></label>
                <label className="block text-xs font-semibold">Experience<select value={skillForm.experienceLevel} onChange={e=>setSkillForm(f=>({...f,experienceLevel:e.target.value}))} className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm"><option>BEGINNER</option><option>INTERMEDIATE</option><option>ADVANCED</option><option>EXPERT</option></select></label>
              </div>
              <label className="block text-xs font-semibold">Visibility<select value={skillForm.visibility} onChange={e=>setSkillForm(f=>({...f,visibility:e.target.value}))} className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm"><option>TEAM_DISCOVERABLE</option><option>PUBLIC_PROFILE</option><option>PRIVATE</option></select></label>
              <button disabled={saving} className="w-full rounded-xl bg-[#f26a4f] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50 inline-flex items-center justify-center gap-2">{saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>} Save skill profile</button>
            </form>
          </div>

          <div className="rounded-2xl bg-[#171a2d] p-6 text-[#fdfbf5]">
            <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">Privacy</div>
            <div className="mt-3 space-y-2 text-xs leading-5">
              <div className="flex items-center gap-2"><Eye size={14} className="text-[#d8e35b]"/><span><b>TEAM_DISCOVERABLE:</b> Visible for matching & team discovery.</span></div>
              <div className="flex items-center gap-2"><EyeOff size={14} className="text-[#9b9fb1]"/><span><b>PRIVATE:</b> Hidden from discover, only team sees you.</span></div>
              <div className="rounded-xl border border-[#2c3047] p-3 text-[#b9bdca]">IDOR prevented — you can only edit your own profile. Server enforces membership checks.</div>
            </div>
            <Link href="/participant/github" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#fdfbf5] px-3 py-2 text-xs font-bold text-[#171a2d]"><Github size={14}/> GitHub connection →</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
