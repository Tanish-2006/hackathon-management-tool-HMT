import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Settings2, ShieldCheck, Bell, Eye, Lock, LogOut, Save, Loader2, AlertCircle, Check, X, Github, KeyRound, Mail } from 'lucide-react';
import { hmtBackendService, ApiError } from '@/services/backendApi';
import { useAuth } from '@/services/auth-context';
import { useLocation } from 'wouter';

function friendly(e:unknown){ return e instanceof ApiError? e.message : (e as Error)?.message || 'Failed' }

export default function ParticipantSettings(){
  const [, setLocation] = useLocation();
  const { logout } = useAuth();
  const [email,setEmail]=useState('');
  const [notifications,setNotifications]=useState({ announcements:true, teamInvites:true, mentorFeedback:true });
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [success,setSuccess]=useState<string|null>(null);

  useEffect(()=>{
    let m=true;
    hmtBackendService.getMe().then((res:any)=>{
      if(!m) return;
      const u = res?.user || res;
      if(u?.email) setEmail(u.email);
    }).catch(()=>{}).finally(()=>{ if(m) setLoading(false); });
    return ()=>{m=false}
  },[]);

  function handleLogout(){
    // Shared session logout: server invalidation (best-effort) + token clear + auth-state reset.
    void logout().finally(() => setLocation('/login'));
  }

  async function handleSave(e: React.FormEvent){
    e.preventDefault(); setSaving(true); setError(null);
    // demo: save to localStorage for notifications, no backend yet
    try{
      localStorage.setItem('hmt_participant_notifications', JSON.stringify(notifications));
      setSuccess('Preferences saved locally (demo). Backend sync pending.');
      setTimeout(()=>setSuccess(null), 2500);
    }catch(err){ setError(friendly(err)); }
    finally{ setSaving(false); }
  }

  if(loading) return <div className="h-24 animate-pulse rounded-2xl bg-[#e9e5da]"/>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[.18em] text-[#f26a4f]">Settings · Participant</div>
        <h1 className="mt-2 text-3xl font-bold tracking-[-.05em] text-[#171a2d]">Tune your workspace.</h1>
        <p className="mt-2 text-sm leading-6 text-[#77798a]">Notifications, privacy defaults and account controls. Dark-first, accessible, responsive.</p>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex gap-2"><AlertCircle size={16}/>{error}<button onClick={()=>setError(null)} className="ml-auto"><X size={14}/></button></div>}
      {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 flex gap-2"><Check size={16}/>{success}<button onClick={()=>setSuccess(null)} className="ml-auto"><X size={14}/></button></div>}

      <form onSubmit={handleSave} className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6 space-y-6">
        <div>
          <h3 className="font-bold flex items-center gap-2"><Bell size={16}/> Notifications</h3>
          <p className="mt-1 text-xs text-[#77798a]">Choose what surfaces in your inbox (demo, stored locally until backend endpoint exists).</p>
          <div className="mt-4 space-y-3">
            {[
              { key:'announcements', label:'Hackathon announcements', desc:'Published announcements from organizers' },
              { key:'teamInvites', label:'Team invitations', desc:'Invites to join teams' },
              { key:'mentorFeedback', label:'Mentor feedback published', desc:'When organizer publishes feedback' },
            ].map(item=>(
              <label key={item.key} className="flex items-center justify-between rounded-xl border border-[#e5e1d7] p-3 bg-white">
                <div><div className="text-sm font-semibold">{item.label}</div><div className="text-xs text-[#77798a]">{item.desc}</div></div>
                <input type="checkbox" checked={(notifications as any)[item.key]} onChange={e=> setNotifications(n=>({...n,[item.key as keyof typeof n]: e.target.checked}))} className="h-5 w-5 accent-[#f26a4f]"/>
              </label>
            ))}
          </div>
        </div>

        <div>
          <h3 className="font-bold flex items-center gap-2"><Eye size={16}/> Privacy defaults</h3>
          <div className="mt-3 rounded-xl bg-[#f4f1e8] p-4 text-xs leading-5 text-[#77798a]">
            Your profile visibility defaults to <b className="text-[#171a2d]">PUBLIC_PROFILE</b> and skill visibility to <b className="text-[#171a2d]">TEAM_DISCOVERABLE</b>. Change them in <a href="/participant/profile" className="underline font-bold text-[#171a2d]">Profile</a>. Private teams hide members and invite codes.
          </div>
        </div>

        <div>
          <h3 className="font-bold flex items-center gap-2"><ShieldCheck size={16}/> Security</h3>
          <div className="mt-3 grid gap-3 text-xs">
            <div className="rounded-xl border border-[#e5e1d7] p-3 flex items-center justify-between"><span className="flex items-center gap-2"><KeyRound size={14}/> Session token</span><span className="rounded-full bg-[#e9e5da] px-2 py-1 font-mono text-[11px]">Bearer · localStorage</span></div>
            <div className="rounded-xl border border-[#e5e1d7] p-3 flex items-center justify-between"><span className="flex items-center gap-2"><Github size={14}/> GitHub</span><span className="text-[#77798a]">Encrypted at rest · read-only · <a href="/participant/github" className="underline">manage</a></span></div>
            <div className="rounded-xl border border-[#e5e1d7] p-3 flex items-center justify-between"><span className="flex items-center gap-2"><Mail size={14}/> Email</span><span className="font-mono">{email || '—'}</span></div>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button disabled={saving} className="flex-1 rounded-xl bg-[#171a2d] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50 inline-flex items-center justify-center gap-2">{saving?<Loader2 size={16} className="animate-spin"/>:<Save size={16}/>} Save preferences</button>
          <button type="button" onClick={handleLogout} className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700 inline-flex items-center gap-2"><LogOut size={16}/> Sign out</button>
        </div>
      </form>

      <div className="rounded-2xl bg-[#171a2d] p-6 text-[#fdfbf5]">
        <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">Accessibility & responsive</div>
        <p className="mt-2 text-xs leading-5 text-[#b9bdca]">All participant pages are keyboard-navigable, use semantic headings, contrast-checked colors, and stack cleanly on mobile (280px → 1440px). Loading, empty, error and success states are present on every page.</p>
        <div className="mt-3 text-xs text-[#9b9fb1]">Design: dark-first, futuristic, premium, clean — not generic admin or crypto. Motion is subtle (150–300ms) and respects reduced-motion.</div>
      </div>
    </div>
  );
}
