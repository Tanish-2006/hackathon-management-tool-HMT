import { useEffect, useState } from 'react';
import { User, Mail, Phone, ShieldCheck, Save, Loader2, AlertCircle, Check, X, MapPin, School, Eye } from 'lucide-react';
import { hmtBackendService, ApiError } from '@/services/backendApi';

function friendly(e:unknown){ return e instanceof ApiError? e.message: (e as Error)?.message || 'Failed' }

const YEARS = ['1st Year','2nd Year','3rd Year','4th Year','Graduate','Other'];

export default function ParticipantProfile(){
  const [user,setUser]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [success,setSuccess]=useState<string|null>(null);
  const [form,setForm]=useState({ fullName:'', institution:'', institutionLocation:'', city:'', course:'', yearOfStudy:'', bio:'', discoveryVisibility:'TEAM_DISCOVERABLE' });

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
        const u:any = me.status==='fulfilled' ? (me.value as any) : null;
        setUser(u?.user || u);
        const p:any = prof.status==='fulfilled' ? prof.value : null;
        const data = p?.profile || p;
        const s:any = sp.status==='fulfilled' ? sp.value : null;
        const skill = s?.skillProfile || s;
        if(m) setForm({
          fullName: data?.fullName || u?.fullName || u?.user?.fullName || '',
          institution: data?.institution || '',
          institutionLocation: data?.institutionLocation || '',
          city: data?.city || '',
          course: data?.course || '',
          yearOfStudy: data?.yearOfStudy || '',
          bio: data?.bio || '',
          discoveryVisibility: skill?.visibility || 'TEAM_DISCOVERABLE',
        });
      }catch(e){ if(m) setError(friendly(e)); }
      finally{ if(m) setLoading(false); }
    }
    load(); return ()=>{m=false}
  },[]);

  const set = (k:string,v:string)=> setForm(f=>({...f,[k]:v}));

  async function save(e: React.FormEvent){
    e.preventDefault(); setSaving(true); setError(null); setSuccess(null);
    try{
      if(!form.fullName.trim()) throw new Error('Full name is required.');
      if(!form.institution.trim()) throw new Error('Institution is required.');
      if(!form.city.trim()) throw new Error('Your city is required.');
      await hmtBackendService.updateProfile({
        fullName: form.fullName.trim(),
        institution: form.institution.trim(),
        institutionLocation: form.institutionLocation.trim() || undefined,
        city: form.city.trim(),
        course: form.course.trim() || undefined,
        yearOfStudy: form.yearOfStudy || undefined,
        bio: form.bio.trim() || undefined,
      });
      // Discovery visibility lives on the skill profile (existing API).
      await hmtBackendService.upsertSkillProfile({ visibility: form.discoveryVisibility }).catch(()=>null);
      const me = await hmtBackendService.getMe().catch(()=>null);
      if(me) setUser((me as any)?.user || me);
      setSuccess('Profile saved');
    }catch(e){ setError(friendly(e)); }
    finally{ setSaving(false); }
  }

  if(loading) return <div className="space-y-4"><div className="h-24 animate-pulse rounded-2xl bg-[#e9e5da]"/><div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]"/></div>

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">Profile</div>
          <h1 className="mt-2 text-3xl font-bold tracking-[-.05em] text-[#171a2d]">Your details.</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#77798a]">Basic information reused everywhere — including hackathon registration, so you never enter it twice.</p>
        </div>
        <span className="rounded-full bg-[#171a2d] px-3 py-1.5 text-xs font-bold text-white">{user?.role ?? '—'}</span>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex gap-2"><AlertCircle size={16}/>{error}<button onClick={()=>setError(null)} className="ml-auto"><X size={14}/></button></div>}
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 flex gap-2"><Check size={16}/>{success}<button onClick={()=>setSuccess(null)} className="ml-auto"><X size={14}/></button></div>}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
          <h3 className="font-bold flex items-center gap-2"><User size={16}/> Profile</h3>
          <form onSubmit={save} className="mt-4 space-y-4" noValidate>
            <div className="flex items-center gap-4">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#f26a4f] text-lg font-bold text-white">{(user?.fullName || form.fullName || 'P').slice(0,2).toUpperCase()}</div>
              <div className="min-w-0"><div className="truncate text-sm font-bold">{user?.fullName || form.fullName || 'Participant'}</div><div className="flex items-center gap-1 text-xs text-[#77798a]"><Mail size={12}/>{user?.email || 'email hidden'}</div></div>
            </div>

            <label className="block text-xs font-semibold">Full name *<input value={form.fullName} onChange={e=>set('fullName',e.target.value)} placeholder="Your full name" required maxLength={160} className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm outline-none focus:border-[#f26a4f]"/></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl bg-[#f4f1e8] p-3 text-xs"><div className="flex items-center gap-1 font-bold"><Mail size={12}/> Email</div><div className="mt-1 truncate text-[#55586a]">{user?.email || '—'}</div><div className="text-[11px] text-[#77798a]">From your account — cannot be changed here.</div></div>
              <div className="rounded-xl bg-[#f4f1e8] p-3 text-xs"><div className="flex items-center gap-1 font-bold"><Phone size={12}/> Phone</div><div className="mt-1 text-[#55586a]">{user?.phoneNumber || '—'} {user?.isPhoneVerified ? <span className="font-bold text-emerald-700">· verified</span> : <span className="font-bold text-[#f26a4f]">· unverified</span>}</div><div className="text-[11px] text-[#77798a]">Verified at signup — contact support to change it.</div></div>
            </div>
            <label className="block text-xs font-semibold">Institution / college / university *<input value={form.institution} onChange={e=>set('institution',e.target.value)} placeholder="e.g. National Institute of Technology" required maxLength={160} className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm outline-none focus:border-[#f26a4f]"/></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-xs font-semibold">Institution location<input value={form.institutionLocation} onChange={e=>set('institutionLocation',e.target.value)} placeholder="City, State" maxLength={160} className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm outline-none focus:border-[#f26a4f]"/></label>
              <label className="block text-xs font-semibold">Your city *<input value={form.city} onChange={e=>set('city',e.target.value)} placeholder="Where you live now" required maxLength={120} className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm outline-none focus:border-[#f26a4f]"/></label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-xs font-semibold">Course / department<input value={form.course} onChange={e=>set('course',e.target.value)} placeholder="Computer Science" maxLength={120} className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm outline-none focus:border-[#f26a4f]"/></label>
              <label className="block text-xs font-semibold">Year of study<select value={form.yearOfStudy} onChange={e=>set('yearOfStudy',e.target.value)} className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm"><option value="">Select…</option>{YEARS.map(y=><option key={y} value={y}>{y}</option>)}</select></label>
            </div>
            <label className="block text-xs font-semibold">Bio (optional)<textarea value={form.bio} onChange={e=>set('bio',e.target.value)} rows={3} placeholder="Builder, systems thinker, loves shipping." maxLength={1000} className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm outline-none focus:border-[#f26a4f]"/></label>

            <button disabled={saving} className="w-full rounded-xl bg-[#171a2d] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50 inline-flex items-center justify-center gap-2">{saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>} Save profile</button>
          </form>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6">
            <h3 className="font-bold flex items-center gap-2"><Eye size={16}/> Team discovery</h3>
            <p className="mt-1 text-xs text-[#77798a]">Controls whether teammates can find you for matching. Your skill details stay in the backend for matching.</p>
            <label className="mt-3 block text-xs font-semibold">Visibility<select value={form.discoveryVisibility} onChange={e=>set('discoveryVisibility',e.target.value)} className="mt-1 w-full rounded-xl border border-[#dedbd1] px-3 py-2 text-sm"><option value="TEAM_DISCOVERABLE">TEAM_DISCOVERABLE</option><option value="PRIVATE">PRIVATE</option><option value="PUBLIC_PROFILE">PUBLIC_PROFILE</option></select><span className="mt-1 block text-[11px] text-[#77798a]">Saved with your profile.</span></label>
          </div>

          <div className="rounded-2xl bg-[#171a2d] p-6 text-[#fdfbf5]">
            <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">Privacy</div>
            <div className="mt-3 space-y-2 text-xs leading-5">
              <div className="flex items-center gap-2"><ShieldCheck size={14} className="text-[#d8e35b]"/><span>Only you can edit your profile — the server enforces it.</span></div>
              <div className="flex items-center gap-2"><MapPin size={14} className="text-[#9b9fb1]"/><span>Location fields are shared with team discovery only.</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
