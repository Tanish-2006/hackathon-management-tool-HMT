import { useEffect, useState } from 'react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { BarChart3, Bell, Check, ChevronDown, ClipboardCheck, FileText, Flag, LayoutDashboard, LogOut, Menu, Plus, Search, Settings2, ShieldCheck, Sparkles, Users, X } from 'lucide-react';
import { getSessionApi, hmtBackendService } from '@/services/backendApi';
import { organizerApi } from '@/services/organizerApi';
import { AuthProvider, displayNameOf, initialsOf, useAuth, type HmtRole } from '@/services/auth-context';
import NotFound from '@/pages/not-found';
import ParticipantDashboard from '@/pages/participant/dashboard';
import ParticipantHackathons from '@/pages/participant/hackathons';
import MyHackathons from '@/pages/participant/my-hackathons';
import ParticipantTeams from '@/pages/participant/teams';
import ParticipantProjects from '@/pages/participant/projects';
import { ParticipantHackathonAI } from '@/pages/participant/hackathon-ai';
import ParticipantAIHelper from '@/pages/participant/ai-helper';
import ParticipantGithub from '@/pages/participant/github';
import ParticipantPerformance from '@/pages/participant/performance';
import ParticipantProfile from '@/pages/participant/profile';
import ParticipantSettings from '@/pages/participant/settings';
import OrganizerDashboard from '@/pages/organizer/dashboard';
import OrganizerHackathons from '@/pages/organizer/hackathons';
import OrganizerHackathonsCreate from '@/pages/organizer/hackathons-create';
import OrganizerQuickCreate from '@/pages/organizer/quick-create';
import OrganizerHackathonDetail from '@/pages/organizer/hackathon-detail';
import OrganizerParticipants from '@/pages/organizer/participants';
import OrganizerTeams from '@/pages/organizer/teams';
import OrganizerMentors from '@/pages/organizer/mentors';
import OrganizerEvaluations from '@/pages/organizer/evaluations';
import OrganizerFeedback from '@/pages/organizer/feedback';
import OrganizerAnalytics from '@/pages/organizer/analytics';
import OrganizerAudit from '@/pages/organizer/audit';
import MentorDashboard from '@/pages/mentor/dashboard';
import MentorTeams from '@/pages/mentor/teams';
import MentorEvaluations from '@/pages/mentor/evaluations';
import MentorFeedback from '@/pages/mentor/feedback';
import MentorProfile from '@/pages/mentor/profile';

const cn = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(' ');

function Logo({ inverse = false }: { inverse?: boolean }) {
  return <Link href="/dashboard" className="flex items-center gap-2.5" data-testid="link-logo"><span className={cn('grid h-8 w-8 place-items-center rounded-[9px] text-sm font-bold', inverse ? 'bg-[#d8e35b] text-[#171a2d]' : 'bg-[#f26a4f] text-[#fdfbf5]')}>H</span><span className="text-[17px] font-bold tracking-[-.04em]">HMT<span className={inverse ? 'text-[#d8e35b]' : 'text-[#f26a4f]'}>.</span></span></Link>;
}

const participantNav = [
  { href: '/participant/dashboard', label: 'Home', icon: LayoutDashboard },
  { href: '/participant/hackathons', label: 'Discover', icon: Search },
  { href: '/participant/my-hackathons', label: 'My Hackathons', icon: Flag },
  { href: '/participant/teams', label: 'My Team', icon: Users },
  { href: '/participant/projects', label: 'My Project', icon: FileText },
  { href: '/participant/ai-helper', label: 'AI Helper', icon: Sparkles },
  { href: '/participant/performance', label: 'Progress', icon: BarChart3 },
  { href: '/participant/profile', label: 'Profile', icon: Settings2 },
];
const organizerNav = [
  { href: '/organizer/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/organizer/hackathons', label: 'Hackathons', icon: Flag },
  { href: '/organizer/participants', label: 'Participants', icon: Users },
  { href: '/organizer/teams', label: 'Teams', icon: Users },
  { href: '/organizer/evaluations', label: 'Evaluations', icon: ClipboardCheck },
  { href: '/organizer/analytics', label: 'Analytics', icon: BarChart3 },
];
const organizerHomeNav = [
  { href: '/organizer/dashboard', label: 'Home', icon: LayoutDashboard },
  ...organizerNav.slice(1),
];
const mentorNav = [
  { href: '/mentor/dashboard', label: 'Mentor Home', icon: LayoutDashboard },
  { href: '/mentor/teams', label: 'Teams', icon: Users },
  { href: '/mentor/evaluations', label: 'Evaluations', icon: ClipboardCheck },
  { href: '/mentor/feedback', label: 'Feedback', icon: FileText },
  { href: '/mentor/profile', label: 'Profile', icon: Settings2 },
];

function Shell({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [notices, setNotices] = useState(false);
  const { user, logout } = useAuth();
  const [notifCount, setNotifCount] = useState(0);
  const [notifList, setNotifList] = useState<any[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  async function refreshNotifs(withList: boolean) {
    if (!user) { setNotifCount(0); if (withList) setNotifList([]); return; }
    try {
      const c: any = await hmtBackendService.getUnreadCount().catch(() => null);
      if (c && typeof c.count === 'number') setNotifCount(c.count);
      if (withList) {
        setNotifLoading(true);
        const l: any = await hmtBackendService.getNotifications().catch(() => null);
        setNotifList(Array.isArray(l) ? l : (l?.data ?? []));
        setNotifLoading(false);
      }
    } catch { setNotifLoading(false); }
  }
  useEffect(() => { refreshNotifs(false); }, [location]);
  useEffect(() => {
    if (!user) return;
    refreshNotifs(false);
    const t = setInterval(() => refreshNotifs(false), 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  function toggleNotices() {
    const next = !notices;
    setNotices(next);
    if (next) refreshNotifs(true);
  }
  async function openNotif(n: any) {
    try { await hmtBackendService.markNotificationRead(n.id); } catch {}
    setNotifList((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    setNotifCount((c) => Math.max(0, c - 1));
    setNotices(false);
    if (n.link) setLocation(n.link);
  }
  async function readAllNotifs() {
    try { await hmtBackendService.markAllNotificationsRead(); } catch {}
    setNotifList((prev) => prev.map((x) => ({ ...x, read: true })));
    setNotifCount(0);
  }
  const visibleNavItems = user?.role === 'ORGANIZER'
    ? organizerHomeNav
    : user?.role === 'ADMIN'
      ? [...participantNav.slice(0, 3), ...organizerNav]
      : user?.role === 'MENTOR'
        ? mentorNav
        : participantNav;
  const handleLogout = async () => {
    await logout();
    setLocation('/login');
  };
  useEffect(() => { document.title = `HMT — ${visibleNavItems.find(n => location.startsWith(n.href))?.label || 'Hackathons'}`; }, [location]);
  return <div className="hmt-app hmt-noise flex min-h-[100dvh]">
    <aside className={cn('hmt-sidebar fixed inset-y-0 left-0 z-30 flex w-[248px] flex-col border-r border-[#2c3047] px-5 py-6 transition-transform duration-300 lg:static lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
      <div className="flex items-center justify-between"><Logo inverse /><button onClick={() => setOpen(false)} className="rounded-md p-1 text-[#c4c7d2] lg:hidden" aria-label="Close menu" data-testid="button-close-menu"><X size={18} /></button></div>
      <div className="mt-12"><div className="mb-3 px-3 font-mono-ui text-[10px] uppercase tracking-[.16em] text-[#8d91a9]">Workspace</div>{visibleNavItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setOpen(false)} className={cn('mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-colors hover:bg-[#2c3047]', location.startsWith(href) && 'bg-[#f26a4f] text-[#fdfbf5] hover:bg-[#f26a4f]')} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon size={16} strokeWidth={1.8} /><span>{label}</span></Link>)}</div>
      <div className="mt-auto space-y-1">{(user?.role === 'ORGANIZER' || user?.role === 'ADMIN') && <Link href="/organizer/hackathons/create" className="mb-4 flex items-center justify-center gap-2 rounded-xl bg-[#d8e35b] px-3 py-3 text-[13px] font-bold text-[#171a2d] transition-transform hover:-translate-y-0.5" data-testid="link-create-sidebar"><Plus size={16} /> New hackathon</Link>}</div>
    </aside>
    {open && <button className="fixed inset-0 z-20 bg-[#171a2d]/40 lg:hidden" onClick={() => setOpen(false)} aria-label="Close navigation" data-testid="button-overlay" />}
    <main className="min-w-0 flex-1">
      <header className="sticky top-0 z-10 flex h-[72px] items-center justify-between border-b border-[#dedbd1] bg-[#f4f1e8]/90 px-5 backdrop-blur-md lg:px-10"><div className="flex items-center gap-3"><button onClick={() => setOpen(true)} className="rounded-lg p-2 hover:bg-[#e9e5da] lg:hidden" aria-label="Open menu" data-testid="button-open-menu"><Menu size={20} /></button></div><div className="flex items-center gap-3"><button onClick={toggleNotices} className="relative rounded-lg p-2 text-[#51546a] hover:bg-[#e9e5da]" aria-label="Notifications" data-testid="button-notifications"><Bell size={18} />{notifCount > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#f26a4f] px-1 text-[9px] font-bold text-white">{notifCount > 9 ? '9+' : notifCount}</span>}</button><div className="flex items-center gap-2 border-l border-[#dedbd1] pl-3"><div className="grid h-8 w-8 place-items-center rounded-full bg-[#5aafbd] text-xs font-bold text-[#171a2d]">{user ? initialsOf(user) : '?'}</div><div className="hidden text-left sm:block"><div className="text-xs font-semibold">{user ? displayNameOf(user) : 'Sign in'}</div><div className="font-mono-ui text-[9px] uppercase tracking-wider text-[#77798a]">{user ? user.role.charAt(0) + user.role.slice(1).toLowerCase() : 'Guest'}</div></div><ChevronDown size={14} className="text-[#77798a]" /></div>{user && <button onClick={handleLogout} className="flex items-center gap-1.5 rounded-lg border border-[#dedbd1] px-3 py-2 text-xs font-bold text-[#51546a] transition-colors hover:bg-[#e9e5da]" aria-label="Log out" data-testid="button-logout"><LogOut size={14} /><span className="hidden sm:inline">Logout</span></button>}</div></header>
      {notices && <div className="absolute right-5 top-[64px] z-20 w-80 rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-4 shadow-xl lg:right-10"><div className="flex items-center justify-between"><b className="text-sm">Inbox{notifCount > 0 && <span className="ml-2 rounded-full bg-[#f26a4f] px-2 py-0.5 text-[10px] font-bold text-white">{notifCount} new</span>}</b><div className="flex items-center gap-2">{notifCount > 0 && <button onClick={readAllNotifs} className="text-[11px] font-semibold text-[#5aafbd] underline">Mark all read</button>}<button onClick={() => setNotices(false)} aria-label="Close inbox" data-testid="button-close-inbox"><X size={15} /></button></div></div>{notifLoading ? <p className="mt-3 text-xs text-[#77798a]">Loading…</p> : notifList.length ? <div className="mt-2 max-h-80 space-y-2 overflow-y-auto">{notifList.map((n:any)=><button key={n.id} onClick={()=>openNotif(n)} className={"w-full rounded-xl border p-3 text-left " + (n.read ? "border-[#e5e1d7] bg-white" : "border-[#f26a4f]/40 bg-[#fff7ea]")}><div className="flex items-center gap-2 text-xs font-bold">{!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#f26a4f]" />}{n.title}</div>{n.body && <p className="mt-1 text-[11px] leading-5 text-[#55586a]">{n.body}</p>}<div className="mt-1 font-mono-ui text-[9px] text-[#aaa9a2]">{n.createdAt ? new Date(n.createdAt).toLocaleString() : ''}{n.link ? ' · tap to open' : ''}</div></button>)}</div> : <p className="mt-3 text-xs leading-relaxed text-[#77798a]">You're all caught up — team requests and updates will appear here.</p>}</div>}
      <div className="mx-auto max-w-[1440px] px-5 py-8 lg:px-10 lg:py-10">{children}</div>
    </main>
  </div>;
}

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) { return <label className="mb-5 block text-sm font-semibold">{label}{required && <span className="ml-1 text-[#f26a4f]" aria-hidden="true">*</span>}{children}{error && <span className="mt-1 block text-xs font-normal text-[#d74635]" role="alert">{error}</span>}</label>; }

function RoleLanding() {
  const { user, initializing } = useAuth();
  const [, setLocation] = useLocation();
  useEffect(() => {
    if (initializing) return;
    if (!user) { setLocation('/login'); return; }
    if (user.role === 'PARTICIPANT') setLocation('/participant/dashboard');
    else if (user.role === 'ORGANIZER' || user.role === 'ADMIN') setLocation('/organizer/dashboard');
    else if (user.role === 'MENTOR') setLocation('/mentor/dashboard');
    else setLocation('/login');
  }, [initializing, user]);
  return <div className="grid place-items-center py-20 text-sm text-[#77798a]"><span className="inline-flex items-center gap-2"><span className="h-4 w-4 animate-spin rounded-full border-2 border-[#dedbd1] border-t-[#171a2d]" /> Loading your workspace…</span></div>;
}

function Auth({ mode }: { mode: 'login' | 'register' | 'forgot' }) {
  const [, setLocation] = useLocation();
  const { refreshAuth, user, initializing } = useAuth();
  const [accountType, setAccountType] = useState<'Participant' | 'Organizer' | 'Mentor'>('Participant');
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  const [pendingHint, setPendingHint] = useState<string | null>(null);
  const [pendingKind, setPendingKind] = useState<'participant' | 'organizer'>('participant');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initializing || loading) return;
    if (!user) return;
    if (user.role === 'PARTICIPANT') setLocation('/participant/dashboard');
    else if (user.role === 'ORGANIZER' || user.role === 'ADMIN') setLocation('/organizer/dashboard');
    else if (user.role === 'MENTOR') setLocation('/mentor/dashboard');
  }, [user, initializing]);

  if (sent) return <AuthFrame><div className="mx-auto max-w-md text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#d8e35b]"><Check /></div><h1 className="mt-6 text-3xl font-bold tracking-[-.05em]">Check your inbox.</h1><p className="mt-3 text-sm leading-6 text-[#77798a]">If an account exists for that email, we sent a secure reset link.</p><button onClick={() => setSent(false)} className="mt-7 text-sm font-bold text-[#f26a4f]" data-testid="button-back-reset">Try another email</button></div></AuthFrame>;

  const isRegister = mode === 'register';

  const targetFor = (r: HmtRole) => r === 'PARTICIPANT' ? '/participant/dashboard' : r === 'MENTOR' ? '/mentor/dashboard' : '/organizer/dashboard';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'forgot') {
      try {
        setLoading(true);
        await hmtBackendService.forgotPassword(email).catch(() => organizerApi.forgotPassword(email).catch(() => null));
      } finally { setLoading(false); }
      setSent(true);
      return;
    }
    const cleanEmail = email.trim();
    const cleanPhone = phone.replace(/[\s\-().]/g, '');
    const needPhone = isRegister;
    if (!cleanEmail || !password || (isRegister && !name.trim()) || (needPhone && !cleanPhone)) {
      setErrorMsg('Please fill in all required fields.');
      return;
    }
    if (needPhone && !/^\+[1-9]\d{7,14}$/.test(cleanPhone)) {
      setErrorMsg('Enter your phone number in international format (e.g. +919876543210).');
      return;
    }
    if (password.length < 8) { setErrorMsg('Password must be at least 8 characters.'); return; }
    setErrorMsg('');
    setLoading(true);
    let justRegisteredPhone: string | null = null;
    let justRegisteredHint: string | null = null;
    let justRegisteredKind: 'participant' | 'organizer' = 'participant';
    try {
      if (isRegister) {
        if (accountType === 'Participant') {
          const reg: any = await hmtBackendService.register({ fullName: name.trim(), email: cleanEmail, password, phoneNumber: cleanPhone });
          if (reg?.phoneVerificationRequired !== false) justRegisteredPhone = cleanPhone;
          if (reg?.phoneOtp) justRegisteredHint = String(reg.phoneOtp);
          justRegisteredKind = 'participant';
        } else {
          const roleStr: HmtRole = accountType === 'Mentor' ? 'MENTOR' : 'ORGANIZER';
          const reg: any = await organizerApi.register({ email: cleanEmail, password, fullName: name.trim(), displayName: name.trim(), role: roleStr, phoneNumber: cleanPhone });
          if (reg?.phoneVerificationRequired !== false) justRegisteredPhone = cleanPhone;
          if (reg?.phoneOtp) justRegisteredHint = String(reg.phoneOtp);
          justRegisteredKind = 'organizer';
        }
      } else {
        let ok = false;
        let lastErr: any = null;
        if (accountType === 'Participant') {
          try { await hmtBackendService.login({ email: cleanEmail, password }); ok = true; }
          catch (err: any) { lastErr = err; }
          if (!ok) {
            try { await organizerApi.login({ email: cleanEmail, password }); ok = true; lastErr = null; }
            catch (err: any) { if (!lastErr) lastErr = err; }
          }
        } else {
          try { await organizerApi.login({ email: cleanEmail, password }); ok = true; }
          catch (err: any) { lastErr = err; }
          if (!ok) {
            try { await hmtBackendService.login({ email: cleanEmail, password }); ok = true; lastErr = null; }
            catch (err: any) { if (!lastErr) lastErr = err; }
          }
        }
        if (!ok) throw lastErr || new Error('Invalid email or password.');
      }
      if (!justRegisteredPhone) await refreshAuth();
    } catch (err: any) {
      const status = err?.status;
      if (status === 409) setErrorMsg('An account with this email or phone number already exists. Try signing in.');
      else if (status === 429) setErrorMsg('Too many attempts. Please wait a moment and try again.');
      else setErrorMsg(err?.message || 'Authentication failed. Check credentials.');
      setLoading(false);
      return;
    }
    setLoading(false);
    if (justRegisteredPhone) { setPendingPhone(justRegisteredPhone); setPendingHint(justRegisteredHint); setPendingKind(justRegisteredKind); return; }
    const client = getSessionApi() === 'organizer' ? organizerApi : hmtBackendService;
    const me: any = await client.getMe().catch(() => null);
    const r = me?.role ?? me?.user?.role;
    setLocation(r === 'PARTICIPANT' || r === 'ORGANIZER' || r === 'MENTOR' || r === 'ADMIN' ? targetFor(r) : '/dashboard');
  };

  if (pendingPhone) {
    return <AuthFrame><div className="mx-auto max-w-md"><div className="mb-10 text-center"><div className="mx-auto w-fit"><Logo /></div><h1 className="mt-8 text-3xl font-bold tracking-[-.06em]">Verify your number.</h1><p className="mt-2 text-sm text-[#77798a]">We sent a 6-digit code to {pendingPhone}.</p></div><VerifyPhonePanel phone={pendingPhone} hint={pendingHint} kind={pendingKind} onVerified={() => { setPendingPhone(null); setPendingHint(null); }} /></div></AuthFrame>;
  }

  return <AuthFrame><div className="mx-auto max-w-md"><div className="mb-10 text-center"><div className="mx-auto w-fit"><Logo /></div><h1 className="mt-8 text-3xl font-bold tracking-[-.06em]">{mode === 'forgot' ? 'Reset your access.' : isRegister ? 'Make room for ideas.' : 'Welcome back, builder.'}</h1><p className="mt-2 text-sm text-[#77798a]">{mode === 'forgot' ? 'No drama. We will get you back in.' : 'Your next great weekend starts here.'}</p></div>{mode !== 'forgot' && <div className="mb-5 flex gap-2 rounded-xl bg-[#e9e5da] p-1" role="group" aria-label="Account type">{(['Participant', 'Organizer', 'Mentor'] as const).map(r => <button key={r} type="button" onClick={() => setAccountType(r)} className={cn('flex-1 rounded-lg py-2 text-[10px] font-bold', accountType === r ? 'bg-[#fdfbf5] shadow-sm' : 'text-[#77798a]')} data-testid={`button-auth-role-${r.toLowerCase()}`}>{r}</button>)}</div>}{errorMsg && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-600" role="alert">{errorMsg}</div>}<form onSubmit={handleSubmit} className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6" noValidate>{isRegister && <Field label="Full name" required><input className="hmt-input" value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" required autoComplete="name" data-testid="input-full-name" /></Field>}<Field label="Email" required><input type="email" className="hmt-input" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" required autoComplete="email" data-testid="input-auth-email" /></Field>{isRegister && <Field label="Phone number" required><input type="tel" className="hmt-input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+919876543210" required autoComplete="tel" data-testid="input-auth-phone" /></Field>}{mode !== 'forgot' && <Field label="Password" required><input type="password" minLength={8} className="hmt-input" value={password} onChange={e => setPassword(e.target.value)} placeholder="8+ characters" required autoComplete={isRegister ? 'new-password' : 'current-password'} data-testid="input-auth-password" /></Field>}<button disabled={loading} className="mt-2 w-full rounded-xl bg-[#f26a4f] px-4 py-3.5 text-sm font-bold text-[#fdfbf5] disabled:opacity-50" data-testid={`button-submit-${mode}`}>{loading ? 'Connecting...' : (mode === 'forgot' ? 'Send reset link' : isRegister ? `Create ${accountType} account` : `Sign in as ${accountType}`)}</button></form><div className="mt-4 text-center text-xs text-[#77798a]">{mode === 'login' ? <span>New here? <Link href="/register" className="font-bold text-[#f26a4f]">Create an account</Link> · <Link href="/forgot-password" className="font-bold text-[#f26a4f]">Forgot password</Link></span> : mode === 'register' ? <span>Have an account? <Link href="/login" className="font-bold text-[#f26a4f]">Sign in</Link></span> : <span><Link href="/login" className="font-bold text-[#f26a4f]">Back to sign in</Link></span>}</div></div></AuthFrame>;
}
function VerifyPhonePanel({ phone, hint, kind, onVerified }: { phone: string; hint: string | null; kind: 'participant' | 'organizer'; onVerified: () => void }) {
  const { refreshAuth } = useAuth();
  const client = kind === 'organizer' ? organizerApi : hmtBackendService;
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState(hint ? `Demo code (dev only): ${hint}` : '');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = code.replace(/\D/g, '');
    if (clean.length !== 6) { setMsg('Enter the 6-digit code we sent.'); return; }
    setMsg('');
    setBusy(true);
    try {
      await client.verifyPhoneOtp(phone, clean);
      await refreshAuth();
      onVerified();
    } catch (err: any) {
      const status = err?.status;
      if (status === 429) setMsg('Too many attempts. Wait a moment, then resend a new code.');
      else setMsg(err?.message || 'Verification failed. Check the code and try again.');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setMsg('');
    setBusy(true);
    try {
      const res = await client.requestPhoneOtp(phone);
      setMsg(res?.phoneOtp ? `Demo code (dev only): ${res.phoneOtp}` : 'New code sent. Check your messages.');
    } catch (err: any) {
      setMsg(err?.message || 'Could not resend the code. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return <form onSubmit={submit} className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6" noValidate>
    {msg && <div className="mb-4 rounded-xl border border-[#dedbd1] bg-[#f4f1e8] p-3 text-xs text-[#171a2d]" role="status">{msg}</div>}
    <Field label="6-digit code" required>
      <input className="hmt-input text-center text-lg font-bold tracking-[.4em]" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" required inputMode="numeric" autoComplete="one-time-code" data-testid="input-phone-otp" />
    </Field>
    <button disabled={busy} className="mt-2 w-full rounded-xl bg-[#f26a4f] px-4 py-3.5 text-sm font-bold text-[#fdfbf5] disabled:opacity-50" data-testid="button-verify-phone">{busy ? 'Verifying...' : 'Verify phone number'}</button>
    <button type="button" disabled={busy} onClick={resend} className="mt-3 w-full text-xs font-bold text-[#f26a4f] disabled:opacity-50" data-testid="button-resend-otp">Resend code</button>
  </form>;
}

function AuthFrame({ children }: { children: React.ReactNode }) { return <div className="hmt-app flex min-h-[100dvh] items-center justify-center bg-[#f4f1e8] px-5 py-10"><div className="w-full">{children}<div className="mx-auto mt-10 max-w-md text-center font-mono-ui text-[9px] uppercase tracking-[.16em] text-[#aaa9a2]">HMT · Plan. Build. Compete. Win.</div></div></div>; }

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, initializing } = useAuth();
  const [, setLocation] = useLocation();
  useEffect(() => {
    if (!initializing && !user) setLocation('/login');
  }, [initializing, user]);
  if (initializing) return <div className="grid place-items-center py-20 text-sm text-[#77798a]"><span className="inline-flex items-center gap-2"><span className="h-4 w-4 animate-spin rounded-full border-2 border-[#dedbd1] border-t-[#171a2d]" /> Verifying session…</span></div>;
  if (!user) return <div className="grid place-items-center py-20 text-sm text-[#77798a]">Redirecting to sign in…</div>;
  return <>{children}</>;
}

function RequireRole({ children, allowed }: { children: React.ReactNode; allowed: HmtRole[] }) {
  const { user, role, initializing } = useAuth();
  if (initializing) return <div className="grid place-items-center py-20 text-sm text-[#77798a]"><span className="inline-flex items-center gap-2"><span className="h-4 w-4 animate-spin rounded-full border-2 border-[#dedbd1] border-t-[#171a2d]" /> Checking permission…</span></div>;
  if (!user || !role) return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
      <h2 className="mt-4 text-xl font-bold">Sign in required</h2>
      <p className="mt-2 text-sm leading-6 text-[#77798a]">Please sign in to continue.</p>
      <div className="mt-6 flex justify-center gap-2">
        <Link href="/login" className="rounded-xl bg-[#171a2d] px-4 py-2 text-xs font-bold text-white">Sign in</Link>
      </div>
    </div>
  );
  if (!allowed.includes(role)) return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#f26a4f] text-white"><ShieldCheck size={22} /></div>
      <h2 className="mt-4 text-xl font-bold">Permission required</h2>
      <p className="mt-2 text-sm leading-6 text-[#77798a]">You don't have access to this page. Sign in with a different account to continue.</p>
      <div className="mt-6 flex justify-center gap-2">
        <Link href="/login" className="rounded-xl bg-[#171a2d] px-4 py-2 text-xs font-bold text-white">Switch account</Link>
        <Link href="/dashboard" className="rounded-xl border border-[#dedbd1] px-4 py-2 text-xs font-bold">Back to dashboard</Link>
      </div>
    </div>
  );
  return <>{children}</>;
}
function RequireParticipant({ children }: { children: React.ReactNode }) { return <RequireAuth><RequireRole allowed={['PARTICIPANT', 'ADMIN']}>{children}</RequireRole></RequireAuth>; }
function RequireOrganizer({ children }: { children: React.ReactNode }) { return <RequireAuth><RequireRole allowed={['ORGANIZER', 'ADMIN']}>{children}</RequireRole></RequireAuth>; }
function RequireMentor({ children }: { children: React.ReactNode }) { return <RequireAuth><RequireRole allowed={['MENTOR', 'ADMIN', 'ORGANIZER']}>{children}</RequireRole></RequireAuth>; }

function AppRoutes() { return <Switch>
<Route path="/" component={RoleLanding} />
<Route path="/dashboard" component={RoleLanding} />
<Route path="/hackathon/create"><Redirect to="/organizer/hackathons/create" /></Route>
<Route path="/participant/dashboard">{() => <RequireParticipant><ParticipantDashboard /></RequireParticipant>}</Route>
<Route path="/participant/hackathons">{() => <RequireParticipant><ParticipantHackathons /></RequireParticipant>}</Route>
<Route path="/participant/my-hackathons">{() => <RequireParticipant><MyHackathons /></RequireParticipant>}</Route>
<Route path="/participant/teams">{() => <RequireParticipant><ParticipantTeams /></RequireParticipant>}</Route>
<Route path="/participant/projects">{() => <RequireParticipant><ParticipantProjects /></RequireParticipant>}</Route>
<Route path="/participant/ai-helper">{() => <RequireParticipant><ParticipantAIHelper /></RequireParticipant>}</Route>
<Route path="/participant/my-hackathons/:id/ai">{() => <RequireParticipant><ParticipantHackathonAI /></RequireParticipant>}</Route>
<Route path="/participant/ai"><Redirect to="/participant/ai-helper" /></Route>
<Route path="/participant/github">{() => <RequireParticipant><ParticipantGithub /></RequireParticipant>}</Route>
<Route path="/participant/performance">{() => <RequireParticipant><ParticipantPerformance /></RequireParticipant>}</Route>
<Route path="/participant/learning"><Redirect to="/participant/performance" /></Route>
<Route path="/participant/profile">{() => <RequireAuth><ParticipantProfile /></RequireAuth>}</Route>
<Route path="/participant/settings">{() => <RequireAuth><ParticipantSettings /></RequireAuth>}</Route>
<Route path="/participant">{() => <RequireParticipant><ParticipantDashboard /></RequireParticipant>}</Route>
<Route path="/organizer/dashboard">{() => <RequireOrganizer><OrganizerDashboard /></RequireOrganizer>}</Route>
<Route path="/organizer/hackathons/create">{() => <RequireOrganizer><OrganizerHackathonsCreate /></RequireOrganizer>}</Route>
<Route path="/organizer/hackathons/quick-create">{() => <RequireOrganizer><OrganizerQuickCreate /></RequireOrganizer>}</Route>
<Route path="/organizer/hackathons/:id">{() => <RequireOrganizer><OrganizerHackathonDetail /></RequireOrganizer>}</Route>
<Route path="/organizer/hackathons">{() => <RequireOrganizer><OrganizerHackathons /></RequireOrganizer>}</Route>
<Route path="/organizer/participants">{() => <RequireOrganizer><OrganizerParticipants /></RequireOrganizer>}</Route>
<Route path="/organizer/teams">{() => <RequireOrganizer><OrganizerTeams /></RequireOrganizer>}</Route>
<Route path="/organizer/mentors">{() => <RequireOrganizer><OrganizerMentors /></RequireOrganizer>}</Route>
<Route path="/organizer/evaluations">{() => <RequireOrganizer><OrganizerEvaluations /></RequireOrganizer>}</Route>
<Route path="/organizer/feedback">{() => <RequireOrganizer><OrganizerFeedback /></RequireOrganizer>}</Route>
<Route path="/organizer/analytics">{() => <RequireOrganizer><OrganizerAnalytics /></RequireOrganizer>}</Route>
<Route path="/organizer/audit">{() => <RequireOrganizer><OrganizerAudit /></RequireOrganizer>}</Route>
<Route path="/organizer">{() => <RequireOrganizer><OrganizerDashboard /></RequireOrganizer>}</Route>
<Route path="/mentor/dashboard">{() => <RequireMentor><MentorDashboard /></RequireMentor>}</Route>
<Route path="/mentor/teams">{() => <RequireMentor><MentorTeams /></RequireMentor>}</Route>
<Route path="/mentor/evaluations">{() => <RequireMentor><MentorEvaluations /></RequireMentor>}</Route>
<Route path="/mentor/feedback">{() => <RequireMentor><MentorFeedback /></RequireMentor>}</Route>
<Route path="/mentor/profile">{() => <RequireMentor><MentorProfile /></RequireMentor>}</Route>
<Route path="/mentor">{() => <RequireMentor><MentorDashboard /></RequireMentor>}</Route>
{['/hackathon/:id', '/judge', '/leaderboard', '/sponsors'].map(path => <Route key={path} path={path}><Redirect to="/dashboard" /></Route>)}<Route path="/login">{() => <Auth mode="login" />}</Route><Route path="/register">{() => <Auth mode="register" />}</Route><Route path="/forgot-password">{() => <Auth mode="forgot" />}</Route><Route component={NotFound} /></Switch>; }
function App() {
  const [location] = useLocation();
  const { initializing } = useAuth();
  const auth = ['/login', '/register', '/forgot-password'].includes(location);
  if (initializing && !auth) {
    return <div className="grid min-h-[100dvh] place-items-center bg-[#f4f1e8] text-sm text-[#77798a]"><span className="inline-flex items-center gap-2"><span className="h-4 w-4 animate-spin rounded-full border-2 border-[#dedbd1] border-t-[#171a2d]" /> Verifying session…</span></div>;
  }
  return auth ? <AppRoutes /> : <Shell><AppRoutes /></Shell>;
}
export default function RootApp() { return <WouterRouter base={(import.meta as any).env.BASE_URL.replace(/\/$/, '')}><AuthProvider><App /></AuthProvider></WouterRouter>; }
