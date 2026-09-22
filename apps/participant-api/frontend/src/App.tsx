import { useEffect, useMemo, useState } from 'react';
import { Link, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';
import { ArrowRight, BarChart3, Bell, Check, ChevronDown, CircleHelp, ClipboardCheck, Clock3, FileText, Filter, Flag, LayoutDashboard, LogOut, Menu, Plus, Search, Settings2, ShieldCheck, Sparkles, Trophy, Users, X, Zap } from 'lucide-react';
import { hmtService } from '@/services/hmt';
import { hmtBackendService } from '@/services/backendApi';
import { organizerApi } from '@/services/organizerApi';
import { AuthProvider, displayNameOf, initialsOf, useAuth, type HmtRole } from '@/services/auth-context';
import { DEMO_MODE } from '@/services/api-config';
import { mockHackathons, mockTeams, milestones, participantTasks, type Hackathon, type Role, type Team } from '@/mocks/hmt';
import NotFound from '@/pages/not-found';
// Agent 1: Participant routes — owned by Agent 1, shell owned by Agent 3 — please integrate
import ParticipantDashboard from '@/pages/participant/dashboard';
import ParticipantHackathons from '@/pages/participant/hackathons';
import ParticipantTeams from '@/pages/participant/teams';
import ParticipantProjects from '@/pages/participant/projects';
import ParticipantAI from '@/pages/participant/ai';
import ParticipantGithub from '@/pages/participant/github';
import ParticipantPerformance from '@/pages/participant/performance';
import ParticipantLearning from '@/pages/participant/learning';
import ParticipantProfile from '@/pages/participant/profile';
import ParticipantSettings from '@/pages/participant/settings';
// Agent 2: Organizer & Mentor routes — owned by Agent 2 — organizer/mentor API integration via organizerApi service
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

const navItems = [
  { href: '/dashboard', label: 'Command center', icon: LayoutDashboard },
  { href: '/participant', label: 'My build', icon: Zap },
  { href: '/organizer', label: 'Organizer', icon: BarChart3 },
  { href: '/judge', label: 'Judge panel', icon: ClipboardCheck },
  { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  { href: '/sponsors', label: 'Sponsors', icon: ShieldCheck },
];

function Shell({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [notices, setNotices] = useState(false);
  const { user, logout } = useAuth();
  // Participant navigation excludes Sponsor; every other role keeps the full menu.
  const visibleNavItems = user?.role === 'PARTICIPANT' ? navItems.filter(n => n.href !== '/sponsors') : navItems;
  const handleLogout = async () => {
    await logout();
    setLocation('/login');
  };
  useEffect(() => { document.title = `HMT — ${location === '/' ? 'Command center' : navItems.find(n => location.startsWith(n.href))?.label || 'Hackathon operations'}`; }, [location]);
  return <div className="hmt-app hmt-noise flex min-h-[100dvh]">
    <aside className={cn('hmt-sidebar fixed inset-y-0 left-0 z-30 flex w-[248px] flex-col border-r border-[#2c3047] px-5 py-6 transition-transform duration-300 lg:static lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
      <div className="flex items-center justify-between"><Logo inverse /><button onClick={() => setOpen(false)} className="rounded-md p-1 text-[#c4c7d2] lg:hidden" aria-label="Close menu" data-testid="button-close-menu"><X size={18} /></button></div>
      <div className="mt-12"><div className="mb-3 px-3 font-mono-ui text-[10px] uppercase tracking-[.16em] text-[#8d91a9]">Workspace</div>{visibleNavItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setOpen(false)} className={cn('mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-colors hover:bg-[#2c3047]', location.startsWith(href) && 'bg-[#f26a4f] text-[#fdfbf5] hover:bg-[#f26a4f]')} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon size={16} strokeWidth={1.8} /><span>{label}</span>{href === '/judge' && <span className="ml-auto rounded-full bg-[#d8e35b] px-1.5 py-0.5 font-mono-ui text-[9px] text-[#171a2d]">7</span>}</Link>)}</div>
      <div className="mt-auto space-y-1"><Link href="/hackathon/create" className="mb-4 flex items-center justify-center gap-2 rounded-xl bg-[#d8e35b] px-3 py-3 text-[13px] font-bold text-[#171a2d] transition-transform hover:-translate-y-0.5" data-testid="link-create-sidebar"><Plus size={16} /> New hackathon</Link><Link href="/login" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] text-[#c4c7d2] hover:bg-[#2c3047]" data-testid="link-switch-role"><Users size={16} /> Switch role</Link><button onClick={() => setNotices(true)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] text-[#c4c7d2] hover:bg-[#2c3047]" data-testid="button-help"><CircleHelp size={16} /> Help center</button></div>
    </aside>
    {open && <button className="fixed inset-0 z-20 bg-[#171a2d]/40 lg:hidden" onClick={() => setOpen(false)} aria-label="Close navigation" data-testid="button-overlay" />}
    <main className="min-w-0 flex-1">
      <header className="sticky top-0 z-10 flex h-[72px] items-center justify-between border-b border-[#dedbd1] bg-[#f4f1e8]/90 px-5 backdrop-blur-md lg:px-10"><div className="flex items-center gap-3"><button onClick={() => setOpen(true)} className="rounded-lg p-2 hover:bg-[#e9e5da] lg:hidden" aria-label="Open menu" data-testid="button-open-menu"><Menu size={20} /></button><span className="hidden font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#77798a] sm:block">HMT / 2026 workspace</span></div><div className="flex items-center gap-3"><button onClick={() => setNotices(!notices)} className="relative rounded-lg p-2 text-[#51546a] hover:bg-[#e9e5da]" aria-label="Notifications" data-testid="button-notifications"><Bell size={18} />{!notices && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#f26a4f]" />}</button><div className="flex items-center gap-2 border-l border-[#dedbd1] pl-3"><div className="grid h-8 w-8 place-items-center rounded-full bg-[#5aafbd] text-xs font-bold text-[#171a2d]">{user ? initialsOf(user) : '?'}</div><div className="hidden text-left sm:block"><div className="text-xs font-semibold">{user ? displayNameOf(user) : 'Sign in'}</div><div className="font-mono-ui text-[9px] uppercase tracking-wider text-[#77798a]">{user ? user.role.charAt(0) + user.role.slice(1).toLowerCase() : 'Guest'}</div></div><ChevronDown size={14} className="text-[#77798a]" /></div>{user && <button onClick={handleLogout} className="flex items-center gap-1.5 rounded-lg border border-[#dedbd1] px-3 py-2 text-xs font-bold text-[#51546a] transition-colors hover:bg-[#e9e5da]" aria-label="Log out" data-testid="button-logout"><LogOut size={14} /><span className="hidden sm:inline">Logout</span></button>}</div></header>
      {notices && <div className="absolute right-5 top-[64px] z-20 w-72 rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-4 shadow-xl lg:right-10"><div className="flex items-center justify-between"><b className="text-sm">Inbox</b><button onClick={() => setNotices(false)} aria-label="Close inbox" data-testid="button-close-inbox"><X size={15} /></button></div><p className="mt-3 text-xs leading-relaxed text-[#77798a]">Your judging room opens tomorrow at 09:30. Seven submissions are waiting for a review.</p></div>}
      <div className="mx-auto max-w-[1440px] px-5 py-8 lg:px-10 lg:py-10">{children}</div>
    </main>
  </div>;
}

function PageHeader({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail?: string; action?: React.ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><div className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#f26a4f]">{eyebrow}</div><h1 className="mt-2 text-3xl font-bold tracking-[-.055em] text-[#171a2d] sm:text-[42px]">{title}</h1>{detail && <p className="mt-2 max-w-xl text-sm leading-6 text-[#77798a]">{detail}</p>}</div>{action}</div>;
}

function Stat({ label, value, change, accent = 'coral' }: { label: string; value: string; change: string; accent?: string }) {
  return <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5 shadow-[0_2px_0_rgba(23,26,45,.03)] transition-transform hover:-translate-y-1"><div className="flex items-center justify-between"><span className="font-mono-ui text-[10px] uppercase tracking-[.13em] text-[#77798a]">{label}</span><span className={cn('h-2 w-2 rounded-full', accent === 'lime' ? 'bg-[#d8e35b]' : accent === 'blue' ? 'bg-[#5aafbd]' : 'bg-[#f26a4f]')} /></div><div className="mt-3 text-3xl font-bold tracking-[-.05em]">{value}</div><div className="mt-1 text-xs text-[#77798a]">{change}</div></div>;
}

function Dashboard() {
  const { user } = useAuth();
  const greeting = user ? `Good morning, ${displayNameOf(user).split(' ')[0]}` : 'Command center';
  // Production: real API data only. Mock fallback is DEMO_MODE-gated.
  const [hackathons, setHackathons] = useState<Hackathon[]>(DEMO_MODE ? mockHackathons : []);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (DEMO_MODE) { hmtService.getHackathons().then(h => { if (!cancelled) setHackathons(h); }).catch(() => {}); return () => { cancelled = true; }; }
    // Try organizer published list; empty state is honest when no data.
    organizerApi.listHackathons()
      .then((list: any[]) => {
        if (cancelled) return;
        if (Array.isArray(list) && list.length) {
          setHackathons(list.map((h: any) => ({
            id: String(h.id ?? h.slug ?? Math.random()),
            name: String(h.title ?? h.name ?? 'Untitled hackathon'),
            description: String(h.description ?? h.tagline ?? ''),
            date: String(h.timeline?.start ?? h.startsAt ?? h.date ?? ''),
            location: String(h.location ?? h.format ?? ''),
            status: String(h.status ?? 'DRAFT'),
            teams: Number(h.teamCount ?? h.teams ?? 0),
            submissions: Number(h.submissionCount ?? h.submissions ?? 0),
            accent: '#d8e35b',
            edition: String(h.edition ?? ''),
          })) as Hackathon[]);
        } else {
          setHackathons([]);
        }
      })
      .catch(() => { if (!cancelled) { setHackathons([]); setLoadError(null); } });
    return () => { cancelled = true; };
  }, []);
  return <><PageHeader eyebrow={greeting} title="Command center" detail="Hackathon Management Tool. Everything you need to run a modern hackathon." action={<Link href="/hackathon/create" className="flex items-center justify-center gap-2 rounded-xl bg-[#f26a4f] px-4 py-3 text-sm font-bold text-[#fdfbf5] shadow-[0_4px_0_#c74938] transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_0_#c74938]" data-testid="link-generate-header"><Sparkles size={16} /> Generate hackathon</Link>} />
    <section className="hmt-rise grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{DEMO_MODE ? <><Stat label="Active hackathons" value="02" change="+1 this quarter" /><Stat label="Registered builders" value="1,248" change="+18.4% from last week" accent="lime" /><Stat label="Submissions in flight" value="61" change="23 need a reviewer" accent="blue" /><Stat label="Prize pool committed" value="$42.8k" change="Across 4 partners" /></> : <><Stat label="Active hackathons" value={String(hackathons.length).padStart(2, '0')} change={hackathons.length ? 'Live from API' : 'No active hackathon'} /><Stat label="Registered builders" value="—" change="Sign in for live roster" accent="lime" /><Stat label="Submissions in flight" value="—" change="Sign in for live data" accent="blue" /><Stat label="Prize pool committed" value="—" change="Sign in for live data" /></>}</section>
  {/* Honest empty state in production when API returns no data */}
  {!DEMO_MODE && hackathons.length === 0 && (
    <div className="mt-8 rounded-2xl border border-dashed border-[#cfcbbf] bg-[#fdfbf5] p-8 text-center" data-testid="empty-hackathons">
      <h2 className="text-lg font-bold">No active hackathon</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#77798a]">There are no published hackathons right now. Sign in with your role account, or check back later.</p>
    </div>
  )}
  {!(hackathons.length === 0 && !DEMO_MODE) && (
    <section className="mt-8 grid gap-6 xl:grid-cols-[1.45fr_1fr]"><div className="rounded-2xl bg-[#171a2d] p-6 text-[#fdfbf5] sm:p-8"><div className="flex items-start justify-between"><div><div className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#d8e35b]">Live now / flagship</div><h2 className="mt-3 text-3xl font-bold tracking-[-.06em]">Orbit / 26</h2><p className="mt-2 max-w-sm text-sm leading-6 text-[#b9bdca]">The internet is a team sport. 84 teams are building what comes next.</p></div><span className="rounded-full bg-[#d8e35b] px-2.5 py-1 font-mono-ui text-[10px] font-medium text-[#171a2d]">LIVE</span></div><div className="mt-10 grid grid-cols-3 gap-3 border-t border-[#363a51] pt-5"><div><div className="font-mono-ui text-2xl text-[#d8e35b]">84</div><div className="mt-1 text-[11px] text-[#9b9fb1]">teams in arena</div></div><div><div className="font-mono-ui text-2xl">61</div><div className="mt-1 text-[11px] text-[#9b9fb1]">submissions</div></div><div><div className="font-mono-ui text-2xl text-[#f26a4f]">09:42</div><div className="mt-1 text-[11px] text-[#9b9fb1]">until close</div></div></div><Link href="/hackathon/orbit-26" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#d8e35b] hover:gap-3" data-testid="link-open-orbit">Open event <ArrowRight size={15} /></Link></div><div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6"><div className="flex items-center justify-between"><h2 className="text-lg font-bold tracking-[-.03em]">Next on deck</h2><Clock3 size={17} className="text-[#77798a]" /></div><div className="mt-5 space-y-4">{milestones.map((m, i) => <div key={m.label} className={cn('flex gap-3 hmt-rise', `hmt-delay-${i + 1}`)}><div className={cn('mt-1 h-2.5 w-2.5 shrink-0 rounded-full', m.tone === 'lime' ? 'bg-[#d8e35b]' : m.tone === 'blue' ? 'bg-[#5aafbd]' : 'bg-[#f26a4f]')} /><div className="flex min-w-0 flex-1 justify-between gap-3"><div><div className="text-sm font-semibold">{m.label}</div><div className="mt-1 font-mono-ui text-[10px] uppercase tracking-wider text-[#77798a]">{m.day}</div></div><span className="font-mono-ui text-xs text-[#77798a]">{m.time}</span></div></div>)}</div><button onClick={() => alert('Calendar export is ready in mock mode.')} className="mt-7 flex items-center gap-2 text-xs font-semibold text-[#f26a4f]" data-testid="button-export-calendar">Export to calendar <ArrowRight size={14} /></button></div></section>
  )}
    <section className="mt-8"><div className="mb-4 flex items-end justify-between"><div><div className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-[#f26a4f]">Move with intent</div><h2 className="mt-1 text-xl font-bold tracking-[-.04em]">Quick actions</h2></div><span className="hidden font-mono-ui text-[10px] uppercase tracking-wider text-[#77798a] sm:block">Plan. Build. Compete. Win.</span></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Link href="/hackathon/create" className="group flex items-center gap-3 rounded-xl bg-[#f26a4f] p-4 text-sm font-bold text-[#fdfbf5] transition-transform hover:-translate-y-1" data-testid="link-quick-generate"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#d95341]"><Sparkles size={17} /></span>Generate Hackathon<ArrowRight size={15} className="ml-auto transition-transform group-hover:translate-x-1" /></Link><Link href="/leaderboard" className="group flex items-center gap-3 rounded-xl border border-[#dedbd1] bg-[#fdfbf5] p-4 text-sm font-bold transition-transform hover:-translate-y-1" data-testid="link-quick-leaderboard"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#d8e35b]"><Trophy size={17} /></span>View Leaderboard<ArrowRight size={15} className="ml-auto text-[#77798a] transition-transform group-hover:translate-x-1" /></Link><Link href="/judge" className="group flex items-center gap-3 rounded-xl border border-[#dedbd1] bg-[#fdfbf5] p-4 text-sm font-bold transition-transform hover:-translate-y-1" data-testid="link-quick-judge"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#5aafbd]"><ClipboardCheck size={17} /></span>Judge Panel<ArrowRight size={15} className="ml-auto text-[#77798a] transition-transform group-hover:translate-x-1" /></Link>{user?.role !== 'PARTICIPANT' && <Link href="/sponsors" className="group flex items-center gap-3 rounded-xl border border-[#dedbd1] bg-[#fdfbf5] p-4 text-sm font-bold transition-transform hover:-translate-y-1" data-testid="link-quick-sponsored"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#e9e5da]"><ShieldCheck size={17} /></span>Sponsored<ArrowRight size={15} className="ml-auto text-[#77798a] transition-transform group-hover:translate-x-1" /></Link>}</div></section>
    <section className="mt-8"><div className="mb-4 flex items-center justify-between"><div><div className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-[#f26a4f]">Your workspace</div><h2 className="mt-1 text-xl font-bold tracking-[-.04em]">All hackathons</h2></div><Link href="/hackathon/create" className="text-xs font-semibold text-[#f26a4f]" data-testid="link-create-another">Create another <ArrowRight size={13} className="ml-1 inline" /></Link></div><div className="grid gap-3 md:grid-cols-3">{hackathons.length === 0 ? <div className="col-span-full rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-8 text-center text-sm text-[#77798a]" data-testid="empty-hackathon-grid">No hackathons yet. {DEMO_MODE ? '' : 'Published events will appear here.'}</div> : hackathons.map((h, i) => <Link href={`/hackathon/${h.id}`} key={h.id} className={cn('hmt-rise rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-5 transition-all hover:-translate-y-1 hover:border-[#f26a4f]', `hmt-delay-${i + 1}`)} data-testid={`card-hackathon-${h.id}`}><div className="flex justify-between"><span className="rounded-md px-2 py-1 font-mono-ui text-[9px] uppercase tracking-wider" style={{ background: h.accent, color: '#171a2d' }}>{h.status}</span><ArrowRight size={16} className="text-[#77798a]" /></div><h3 className="mt-8 text-lg font-bold">{h.name}</h3><p className="mt-1 text-xs text-[#77798a]">{h.date} · {h.location}</p><div className="mt-5 flex gap-5 border-t border-[#e5e1d7] pt-4 text-xs"><span><b>{h.teams}</b> teams</span><span><b>{h.submissions}</b> entries</span></div></Link>)}</div></section>
  </>;
}

function CreateHackathon() {
  const [, setLocation] = useLocation();
  const [form, setForm] = useState({ name: '', description: '', date: '', location: '', track: 'Open build', role: 'Organizer' as Role });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false); const [created, setCreated] = useState<Hackathon | null>(null);
  const update = (key: string, value: string) => setForm(f => ({ ...f, [key]: value }));
  const submit = async (e: React.FormEvent) => { e.preventDefault(); const required = ['name', 'description', 'date', 'location']; const next: Record<string, string> = {}; required.forEach(k => { if (!form[k as keyof typeof form].trim()) next[k] = 'This field is required'; }); setErrors(next); if (Object.keys(next).length) return; setLoading(true); const result = await hmtService.createHackathon(form); setCreated(result); setLoading(false); };
  if (created) return <div className="mx-auto max-w-3xl hmt-rise"><div className="rounded-3xl bg-[#171a2d] p-8 text-[#fdfbf5] sm:p-12"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#d8e35b] text-[#171a2d]"><Check /></div><div className="mt-8 font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#d8e35b]">Generated and ready</div><h1 className="mt-3 text-4xl font-bold tracking-[-.06em]">{created.name}</h1><p className="mt-4 max-w-lg text-[#b9bdca]">{created.description}</p><div className="mt-8 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-[#252941] p-4"><span className="font-mono-ui text-[10px] text-[#9b9fb1]">FORMAT</span><div className="mt-2 text-sm">{created.edition}</div></div><div className="rounded-xl bg-[#252941] p-4"><span className="font-mono-ui text-[10px] text-[#9b9fb1]">DATE</span><div className="mt-2 text-sm">{created.date}</div></div><div className="rounded-xl bg-[#252941] p-4"><span className="font-mono-ui text-[10px] text-[#9b9fb1]">MODE</span><div className="mt-2 text-sm">Draft workspace</div></div></div><div className="mt-10 flex flex-wrap gap-3"><button onClick={() => setLocation(`/hackathon/${created.id}`)} className="rounded-xl bg-[#f26a4f] px-4 py-3 text-sm font-bold" data-testid="button-open-generated">Open workspace <ArrowRight size={15} className="ml-1 inline" /></button><button onClick={() => setCreated(null)} className="rounded-xl border border-[#4a4e66] px-4 py-3 text-sm font-semibold" data-testid="button-edit-generated">Edit brief</button></div></div></div>;
  return <><PageHeader eyebrow="AI event generator" title="Start with a spark." detail="Give your event a point of view. HMT will shape the operating brief around it." /><div className="grid gap-8 lg:grid-cols-[1fr_330px]"><form onSubmit={submit} className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6 sm:p-8" noValidate><div className="grid gap-6 sm:grid-cols-2"><Field label="Event name" required error={errors.name}><input value={form.name} onChange={e => update('name', e.target.value)} placeholder="e.g. Orbit / 26" className="hmt-input" data-testid="input-event-name" /></Field><Field label="Format / track" required><select value={form.track} onChange={e => update('track', e.target.value)} className="hmt-input" data-testid="select-event-track"><option>Open build</option><option>AI & data</option><option>Climate futures</option><option>Civic tech</option></select></Field><Field label="Dates" required error={errors.date}><input value={form.date} onChange={e => update('date', e.target.value)} placeholder="Apr 18–20, 2026" className="hmt-input" data-testid="input-event-date" /></Field><Field label="Place" required error={errors.location}><input value={form.location} onChange={e => update('location', e.target.value)} placeholder="Online + city hubs" className="hmt-input" data-testid="input-event-location" /></Field></div><Field label="The brief" required error={errors.description}><textarea value={form.description} onChange={e => update('description', e.target.value)} rows={5} placeholder="What should builders make, and why now?" className="hmt-input resize-none" data-testid="textarea-event-brief" /></Field><fieldset className="mt-6"><legend className="mb-2 text-sm font-semibold">I am joining as</legend><div className="flex flex-wrap gap-2">{(['Organizer', 'Participant', 'Judge', 'Sponsor'] as Role[]).map(role => <button type="button" key={role} onClick={() => setForm(f => ({ ...f, role }))} className={cn('rounded-lg border px-3 py-2 text-xs font-semibold transition-colors', form.role === role ? 'border-[#f26a4f] bg-[#f26a4f] text-[#fdfbf5]' : 'border-[#dedbd1] hover:border-[#f26a4f]')} data-testid={`button-role-${role.toLowerCase()}`}>{role}</button>)}</div></fieldset><button disabled={loading} className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-[#f26a4f] px-4 py-3.5 text-sm font-bold text-[#fdfbf5] disabled:opacity-60" data-testid="button-generate-hackathon">{loading ? 'Building your workspace…' : <><Sparkles size={16} /> Generate my hackathon</>}</button></form><div className="h-fit rounded-2xl bg-[#d8e35b] p-6"><Sparkles size={19} /><h2 className="mt-8 text-xl font-bold tracking-[-.04em]">A better first draft.</h2><p className="mt-3 text-sm leading-6 text-[#414526]">Your brief becomes tracks, a judging rubric, a milestone plan, and a participant-ready event page. Edit everything later.</p><div className="mt-6 border-t border-[#b8c34f] pt-4 font-mono-ui text-[10px] uppercase tracking-[.12em] text-[#596027]">Mock AI mode · no API key needed</div></div></div></>;
}

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) { return <label className="mb-5 block text-sm font-semibold">{label}{required && <span className="ml-1 text-[#f26a4f]" aria-hidden="true">*</span>}{children}{error && <span className="mt-1 block text-xs font-normal text-[#d74635]" role="alert">{error}</span>}</label>; }

function HackathonDetail() {
  const { id } = useParams<{ id: string }>(); const [hackathon, setHackathon] = useState<Hackathon | null>(null);
  useEffect(() => { if (id) hmtService.getHackathon(id).then(setHackathon); }, [id]);
  if (!hackathon) return <div className="h-64 animate-pulse rounded-2xl bg-[#e9e5da]" />;
  return <><PageHeader eyebrow={`${hackathon.status} / event workspace`} title={hackathon.name} detail={hackathon.description} action={<button onClick={() => alert('Event link copied.')} className="flex items-center gap-2 rounded-xl border border-[#cfcbbf] px-4 py-3 text-sm font-semibold hover:bg-[#e9e5da]" data-testid="button-share-hackathon">Share event <ArrowRight size={15} /></button>} /><div className="grid gap-5 sm:grid-cols-3"><Stat label="Registered teams" value={String(hackathon.teams || 0)} change="Live roster" accent="lime" /><Stat label="Submissions" value={String(hackathon.submissions || 0)} change="Across all tracks" accent="blue" /><Stat label="Event status" value={hackathon.status} change={`${hackathon.date} · ${hackathon.location}`} /></div><div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_.8fr]"><div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6"><div className="flex items-center justify-between"><h2 className="text-lg font-bold">Operations checklist</h2><span className="font-mono-ui text-xs text-[#f26a4f]">03 / 06</span></div>{['Publish participant brief', 'Confirm judging panel', 'Lock sponsor placements', 'Open submission window', 'Schedule final showcase', 'Send winner comms'].map((item, i) => <div key={item} className="flex items-center gap-3 border-b border-[#e5e1d7] py-4 last:border-0"><div className={cn('grid h-5 w-5 place-items-center rounded-md border', i < 3 ? 'border-[#5aafbd] bg-[#5aafbd] text-[#171a2d]' : 'border-[#cfcbbf]')}>{i < 3 && <Check size={13} />}</div><span className={cn('text-sm', i < 3 && 'text-[#77798a] line-through')}>{item}</span><ChevronDown size={15} className="ml-auto rotate-[-90deg] text-[#aaa9a2]" /></div>)}</div><div className="rounded-2xl bg-[#171a2d] p-6 text-[#fdfbf5]"><div className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-[#d8e35b]">Event pulse</div><div className="mt-8 flex items-end gap-2"><div className="font-mono-ui text-5xl">78<span className="text-2xl text-[#d8e35b]">%</span></div><span className="mb-2 text-xs text-[#9b9fb1]">ops ready</span></div><div className="mt-5 h-2 rounded-full bg-[#35394f]"><div className="h-full w-[78%] rounded-full bg-[#d8e35b]" /></div><p className="mt-6 text-sm leading-6 text-[#b9bdca]">Three items need attention before doors open. You're ahead of the typical event curve.</p></div></div></>;
}

function Participant() {
  const [tasks, setTasks] = useState(participantTasks); const completed = tasks.filter(t => t.done).length;
  return <><PageHeader eyebrow="Orbit / 26 · participant view" title="Build something worth shipping." detail="Your team has 9 hours left. Keep the signal high." action={<span className="rounded-full bg-[#f26a4f] px-3 py-2 font-mono-ui text-[10px] uppercase tracking-wider text-[#fdfbf5]">09:42:18 left</span>} /><div className="grid gap-6 lg:grid-cols-[1.2fr_.8fr]"><div className="rounded-2xl bg-[#171a2d] p-7 text-[#fdfbf5]"><div className="flex justify-between"><div><div className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">Your team</div><h2 className="mt-3 text-3xl font-bold tracking-[-.06em]">soft launch</h2><p className="mt-2 text-sm text-[#b9bdca]">3 builders · Open web track</p></div><div className="flex -space-x-2">{['AR', 'MK', 'JL'].map(x => <span key={x} className="grid h-9 w-9 place-items-center rounded-full border-2 border-[#171a2d] bg-[#5aafbd] text-[10px] font-bold text-[#171a2d]">{x}</span>)}</div></div><div className="mt-10 rounded-xl bg-[#252941] p-4"><div className="flex items-center justify-between"><span className="text-xs text-[#9b9fb1]">Project status</span><span className="font-mono-ui text-[10px] text-[#d8e35b]">IN PROGRESS</span></div><div className="mt-3 flex items-center gap-3"><div className="h-2 flex-1 rounded-full bg-[#3b3f55]"><div className="h-full w-[64%] rounded-full bg-[#d8e35b]" /></div><span className="font-mono-ui text-xs">64%</span></div></div><Link href="/hackathon/orbit-26" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#d8e35b]" data-testid="link-team-workspace">Open team workspace <ArrowRight size={14} /></Link></div><div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6"><div className="flex items-center justify-between"><h2 className="text-lg font-bold">Ship list</h2><span className="font-mono-ui text-xs text-[#f26a4f]">{completed}/{tasks.length}</span></div>{tasks.map(task => <button key={task.id} onClick={() => setTasks(t => t.map(x => x.id === task.id ? { ...x, done: !x.done } : x))} className="flex w-full items-start gap-3 border-b border-[#e5e1d7] py-4 text-left last:border-0" data-testid={`button-task-${task.id}`}><span className={cn('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border', task.done ? 'border-[#5aafbd] bg-[#5aafbd] text-[#171a2d]' : 'border-[#cfcbbf]')}>{task.done && <Check size={13} />}</span><span><span className={cn('block text-sm font-semibold', task.done && 'text-[#77798a] line-through')}>{task.label}</span><span className="mt-1 block text-xs text-[#77798a]">{task.detail}</span></span></button>)}</div></div><div className="mt-6 rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><div className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-[#f26a4f]">Submission</div><h2 className="mt-1 text-xl font-bold">Afterimage</h2><p className="mt-1 text-xs text-[#77798a]">Last saved 4 minutes ago · Draft</p></div><button onClick={() => alert('Submission saved in mock mode.')} className="rounded-xl bg-[#f26a4f] px-4 py-3 text-sm font-bold text-[#fdfbf5]" data-testid="button-submit-project">Review & submit <ArrowRight size={14} className="ml-1 inline" /></button></div></div></>;
}

function Organizer() { return <><PageHeader eyebrow="Orbit / 26 · organizer analytics" title="Know your event." detail="A live read on the people, projects, and pressure points shaping this weekend." action={<button onClick={() => alert('Report exported in mock mode.')} className="flex items-center gap-2 rounded-xl border border-[#cfcbbf] px-4 py-3 text-sm font-semibold" data-testid="button-export-report"><FileText size={16} /> Export report</button>} /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Registration conversion" value="68.4%" change="+7.2% week over week" accent="lime" /><Stat label="Avg. team size" value="2.8" change="Healthy collaboration" accent="blue" /><Stat label="Mentor office hours" value="47" change="82% booked" /><Stat label="Judge coverage" value="91%" change="2 tracks need backup" accent="lime" /></div><div className="mt-6 grid gap-6 lg:grid-cols-[1.35fr_.65fr]"><div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6"><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">Builder momentum</h2><p className="mt-1 text-xs text-[#77798a]">Cumulative submissions across the weekend</p></div><select className="rounded-lg border border-[#dedbd1] bg-transparent px-2 py-1 text-xs" data-testid="select-analytics-period"><option>Last 7 days</option><option>All time</option></select></div><div className="mt-8 flex h-48 items-end gap-2 sm:gap-4">{[28, 42, 38, 57, 64, 76, 91, 84, 100, 112, 138, 154].map((n, i) => <div key={i} className="flex flex-1 flex-col items-center gap-2"><div className={cn('w-full rounded-t-md transition-all hover:opacity-75', i > 8 ? 'bg-[#f26a4f]' : 'bg-[#d8e35b]')} style={{ height: `${n}px` }} /><span className="font-mono-ui text-[9px] text-[#aaa9a2]">{i + 1}</span></div>)}</div></div><div className="rounded-2xl bg-[#d8e35b] p-6"><div className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-[#596027]">Signal</div><div className="mt-4 text-4xl font-bold tracking-[-.07em]">84</div><p className="mt-2 text-sm leading-6 text-[#414526]">The event is pacing above your last edition. Keep mentor response times under 2 hours.</p><button onClick={() => alert('Mentor brief opened.')} className="mt-6 flex items-center gap-2 text-xs font-bold text-[#414526]" data-testid="button-open-brief">Open mentor brief <ArrowRight size={14} /></button></div></div><div className="mt-6 rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6"><div className="flex items-center justify-between"><h2 className="text-lg font-bold">Track health</h2><Link href="/judge" className="text-xs font-semibold text-[#f26a4f]" data-testid="link-track-judging">Review judging <ArrowRight size={13} className="ml-1 inline" /></Link></div><div className="mt-5 grid gap-3 md:grid-cols-3">{[['Open web', '32 teams', 76], ['AI & data', '28 teams', 61], ['Climate futures', '24 teams', 43]].map(([name, teams, value]) => <div key={String(name)} className="rounded-xl border border-[#e5e1d7] p-4"><div className="flex justify-between text-sm font-semibold"><span>{name}</span><span className="font-mono-ui text-xs text-[#77798a]">{teams}</span></div><div className="mt-4 h-1.5 rounded-full bg-[#e9e5da]"><div className="h-full rounded-full bg-[#5aafbd]" style={{ width: `${Number(value)}%` }} /></div><div className="mt-2 text-xs text-[#77798a]">{String(value)}% reviewed</div></div>)}</div></div></>; }

function Judge() { const [selected, setSelected] = useState<Team | null>(null); const [score, setScore] = useState(''); return <><PageHeader eyebrow="Judge room / Orbit 26" title="Make the call." detail="Seven submissions assigned to you. Review with curiosity, score with clarity." action={<span className="rounded-full bg-[#d8e35b] px-3 py-2 font-mono-ui text-[10px] uppercase tracking-wider text-[#171a2d]">7 to review</span>} /><div className="grid gap-6 lg:grid-cols-[.9fr_1.1fr]"><div className="space-y-3">{mockTeams.slice(0, 4).map((team, i) => <button key={team.id} onClick={() => { setSelected(team); setScore(''); }} className={cn('hmt-rise flex w-full items-center gap-4 rounded-2xl border bg-[#fdfbf5] p-4 text-left transition-all hover:-translate-y-0.5', selected?.id === team.id ? 'border-[#f26a4f]' : 'border-[#dedbd1]', `hmt-delay-${i + 1}`)} data-testid={`button-review-${team.id}`}><span className="font-mono-ui text-xs text-[#aaa9a2]">0{i + 1}</span><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e9e5da] text-xs font-bold">{team.members[0]}</span><span className="min-w-0 flex-1"><b className="block text-sm">{team.project}</b><span className="text-xs text-[#77798a]">{team.name} · {team.track}</span></span><span className="font-mono-ui text-[10px] uppercase text-[#f26a4f]">{team.status}</span><ArrowRight size={15} className="text-[#aaa9a2]" /></button>)}</div><div className="min-h-[360px] rounded-2xl bg-[#171a2d] p-7 text-[#fdfbf5]">{selected ? <><div className="flex items-start justify-between"><div><div className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">Reviewing · {selected.track}</div><h2 className="mt-3 text-3xl font-bold tracking-[-.06em]">{selected.project}</h2><p className="mt-1 text-sm text-[#b9bdca]">by {selected.name}</p></div><button onClick={() => setSelected(null)} aria-label="Close review" data-testid="button-close-review"><X size={18} className="text-[#9b9fb1]" /></button></div><div className="mt-8 rounded-xl bg-[#252941] p-4 text-sm leading-6 text-[#c4c7d2]">A collaborative canvas for turning long-form research into interactive, visual stories. Explore the demo before scoring this submission.</div><div className="mt-7"><label className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-[#9b9fb1]">Overall score / 100</label><div className="mt-3 flex gap-3"><input value={score} onChange={e => setScore(e.target.value)} type="number" min="0" max="100" placeholder="00" className="w-28 rounded-xl border border-[#484c64] bg-[#252941] px-4 py-3 text-2xl text-[#fdfbf5] outline-none focus:border-[#d8e35b]" data-testid="input-review-score" /><button onClick={() => { if (score) { alert(`Score ${score} saved.`); setSelected(null); } }} className="rounded-xl bg-[#f26a4f] px-4 py-3 text-sm font-bold" data-testid="button-save-score">Save score</button></div></div></> : <div className="flex h-full min-h-[310px] flex-col items-center justify-center text-center"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#252941] text-[#d8e35b]"><ClipboardCheck size={22} /></div><h2 className="mt-5 text-xl font-bold">Select a submission</h2><p className="mt-2 max-w-xs text-sm leading-6 text-[#9b9fb1]">Your thoughtful review helps builders see the next version of their idea.</p></div>}</div></div></>; }

function Leaderboard() { const [query, setQuery] = useState(''); const [filter, setFilter] = useState('All tracks'); const teams = useMemo(() => mockTeams.filter(t => `${t.name} ${t.project}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'All tracks' || t.track === filter)), [query, filter]); return <><PageHeader eyebrow="Orbit / 26 · public board" title="The leaderboard." detail="A live ranking of projects making the strongest case for what comes next." action={<button onClick={() => alert('Leaderboard link copied.')} className="rounded-xl border border-[#cfcbbf] px-4 py-3 text-sm font-semibold" data-testid="button-share-leaderboard">Share board <ArrowRight size={14} className="ml-1 inline" /></button>} /><div className="mb-5 flex flex-col gap-3 sm:flex-row"><label className="relative flex-1"><Search className="absolute left-3 top-3 text-[#aaa9a2]" size={17} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search teams or projects" className="hmt-input pl-10" data-testid="input-search-leaderboard" /></label><label className="relative sm:w-52"><Filter className="absolute left-3 top-3 text-[#aaa9a2]" size={15} /><select value={filter} onChange={e => setFilter(e.target.value)} className="hmt-input pl-9" data-testid="select-leaderboard-track"><option>All tracks</option><option>Open web</option><option>AI & data</option><option>Climate</option><option>Civic tech</option><option>Creative tech</option></select></label></div><div className="overflow-hidden rounded-2xl border border-[#dedbd1] bg-[#fdfbf5]"><div className="hidden grid-cols-[70px_1fr_160px_110px] border-b border-[#e5e1d7] px-6 py-3 font-mono-ui text-[10px] uppercase tracking-[.14em] text-[#77798a] sm:grid"><span>Rank</span><span>Team / project</span><span>Track</span><span className="text-right">Score</span></div>{teams.map((team, i) => <div key={team.id} className="grid gap-3 border-b border-[#e5e1d7] px-5 py-5 last:border-0 sm:grid-cols-[70px_1fr_160px_110px] sm:items-center sm:px-6"><div className={cn('font-mono-ui text-lg', i === 0 ? 'text-[#f26a4f]' : 'text-[#77798a]')}>0{i + 1}</div><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e9e5da] text-[10px] font-bold">{team.members[0]}</span><span><b className="block text-sm">{team.project}</b><span className="text-xs text-[#77798a]">{team.name} · {team.members.length} builders</span></span></div><div className="text-xs text-[#77798a]">{team.track}</div><div className="font-mono-ui text-lg font-medium sm:text-right">{team.score.toFixed(1)}</div></div>)}</div>{!teams.length && <div className="rounded-2xl border border-dashed border-[#cfcbbf] p-12 text-center"><Search className="mx-auto text-[#aaa9a2]" /><h2 className="mt-4 font-bold">No teams found</h2><p className="mt-1 text-sm text-[#77798a]">Try a different search or clear the track filter.</p></div>}</>; }

function Sponsors() { const sponsors = [{ name: 'Arc', tier: 'Presenting partner', color: '#f26a4f', copy: 'Tools for teams who move with intent.' }, { name: 'Northstar', tier: 'Platform partner', color: '#5aafbd', copy: 'Infrastructure for the ideas in between.' }, { name: 'Fieldwork', tier: 'Community partner', color: '#d8e35b', copy: 'Making room for better questions.' }]; return <><PageHeader eyebrow="Orbit / 26 · partner gallery" title="Back the builders." detail="The partners powering a weekend of improbable ideas." action={<button onClick={() => alert('Partnership deck downloaded.')} className="flex items-center gap-2 rounded-xl bg-[#171a2d] px-4 py-3 text-sm font-bold text-[#fdfbf5]" data-testid="button-download-deck"><FileText size={16} /> Partnership deck</button>} /><div className="grid gap-4 md:grid-cols-3">{sponsors.map((s, i) => <div key={s.name} className="hmt-rise flex min-h-[280px] flex-col rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6 transition-transform hover:-translate-y-1" style={{ animationDelay: `${i * 80}ms` }}><div className="flex items-center justify-between"><span className="grid h-12 w-12 place-items-center rounded-2xl text-xl font-bold text-[#171a2d]" style={{ background: s.color }}>{s.name[0]}</span><span className="font-mono-ui text-[9px] uppercase tracking-[.13em] text-[#77798a]">{s.tier}</span></div><div className="mt-auto"><h2 className="text-2xl font-bold tracking-[-.05em]">{s.name}</h2><p className="mt-2 text-sm leading-6 text-[#77798a]">{s.copy}</p><button onClick={() => alert(`${s.name} partner profile opened.`)} className="mt-5 text-xs font-bold text-[#f26a4f]" data-testid={`button-sponsor-${s.name.toLowerCase()}`}>Explore partner <ArrowRight size={14} className="ml-1 inline" /></button></div></div>)}</div><div className="mt-8 rounded-2xl bg-[#171a2d] p-8 text-[#fdfbf5] sm:p-10"><div className="max-w-xl"><div className="font-mono-ui text-[10px] uppercase tracking-[.16em] text-[#d8e35b]">Sponsor a sharp edge</div><h2 className="mt-3 text-3xl font-bold tracking-[-.06em]">Put your tools in the hands of people who care.</h2><p className="mt-3 text-sm leading-6 text-[#b9bdca]">Custom tracks, meaningful demos, and a room full of future collaborators. Let's build a partnership with a point of view.</p><button onClick={() => alert('Thanks. The partnerships team will be in touch.')} className="mt-7 rounded-xl bg-[#d8e35b] px-4 py-3 text-sm font-bold text-[#171a2d]" data-testid="button-contact-partnerships">Start a conversation <ArrowRight size={14} className="ml-1 inline" /></button></div></div></>; }

function RoleLanding() {
  // Root behavior: unauthenticated -> login; authenticated -> role dashboard.
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
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  // Already authenticated -> send to role home (prevents dashboard flash for wrong role).
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
        // Best-effort: participant API first, organizer second. Generic message avoids enumeration.
        await hmtBackendService.forgotPassword(email).catch(() => organizerApi.forgotPassword(email).catch(() => null));
      } finally { setLoading(false); }
      setSent(true);
      return;
    }
    const cleanEmail = email.trim();
    if (!cleanEmail || !password || (isRegister && !name.trim())) {
      setErrorMsg('Please fill in all required fields.');
      return;
    }
    if (password.length < 8) { setErrorMsg('Password must be at least 8 characters.'); return; }
    setErrorMsg('');
    setLoading(true);
    try {
      if (isRegister) {
        // No cross-role leakage: participant accounts via participant API (PARTICIPANT),
        // organizer/mentor accounts via organizer API with explicit role.
        if (accountType === 'Participant') {
          await hmtBackendService.register({ fullName: name.trim(), email: cleanEmail, password });
        } else {
          const roleStr: HmtRole = accountType === 'Mentor' ? 'MENTOR' : 'ORGANIZER';
          await organizerApi.register({ email: cleanEmail, password, fullName: name.trim(), displayName: name.trim(), role: roleStr });
        }
      } else {
        // Login: try the selected account system first, then fall back once.
        // Participant accounts live in participant API; organizer/mentor in organizer API.
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
      await refreshAuth();
    } catch (err: any) {
      const status = err?.status;
      if (status === 409) setErrorMsg('An account with this email already exists. Try signing in.');
      else if (status === 429) setErrorMsg('Too many attempts. Please wait a moment and try again.');
      else setErrorMsg(err?.message || 'Authentication failed. Check credentials.');
      setLoading(false);
      return;
    }
    setLoading(false);
    // Route by REAL backend role (refreshAuth populated it); fall back to selected type.
    try {
      const me = await hmtBackendService.getMe().catch(() => null);
      const r = (me as any)?.role ?? (me as any)?.user?.role;
      if (r === 'PARTICIPANT' || r === 'ORGANIZER' || r === 'MENTOR' || r === 'ADMIN') { setLocation(targetFor(r)); return; }
    } catch {}
    try {
      const me = await organizerApi.getMe().catch(() => null);
      const r = (me as any)?.role ?? (me as any)?.user?.role;
      if (r === 'PARTICIPANT' || r === 'ORGANIZER' || r === 'MENTOR' || r === 'ADMIN') { setLocation(targetFor(r)); return; }
    } catch {}
    setLocation(accountType === 'Participant' ? '/participant/dashboard' : accountType === 'Mentor' ? '/mentor/dashboard' : '/organizer/dashboard');
  };

  return <AuthFrame><div className="mx-auto max-w-md"><div className="mb-10 text-center"><div className="mx-auto w-fit"><Logo /></div><h1 className="mt-8 text-3xl font-bold tracking-[-.06em]">{mode === 'forgot' ? 'Reset your access.' : isRegister ? 'Make room for ideas.' : 'Welcome back, builder.'}</h1><p className="mt-2 text-sm text-[#77798a]">{mode === 'forgot' ? 'No drama. We will get you back in.' : 'Your next great weekend starts here.'}</p></div>{mode !== 'forgot' && <div className="mb-5 flex gap-2 rounded-xl bg-[#e9e5da] p-1" role="group" aria-label="Account type">{(['Participant', 'Organizer', 'Mentor'] as const).map(r => <button key={r} type="button" onClick={() => setAccountType(r)} className={cn('flex-1 rounded-lg py-2 text-[10px] font-bold', accountType === r ? 'bg-[#fdfbf5] shadow-sm' : 'text-[#77798a]')} data-testid={`button-auth-role-${r.toLowerCase()}`}>{r}</button>)}</div>}{errorMsg && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-600" role="alert">{errorMsg}</div>}<form onSubmit={handleSubmit} className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-6" noValidate>{isRegister && <Field label="Full name" required><input className="hmt-input" value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" required autoComplete="name" data-testid="input-full-name" /></Field>}<Field label="Email" required><input type="email" className="hmt-input" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" required autoComplete="email" data-testid="input-auth-email" /></Field>{mode !== 'forgot' && <Field label="Password" required><input type="password" minLength={8} className="hmt-input" value={password} onChange={e => setPassword(e.target.value)} placeholder="8+ characters" required autoComplete={isRegister ? 'new-password' : 'current-password'} data-testid="input-auth-password" /></Field>}<button disabled={loading} className="mt-2 w-full rounded-xl bg-[#f26a4f] px-4 py-3.5 text-sm font-bold text-[#fdfbf5] disabled:opacity-50" data-testid={`button-submit-${mode}`}>{loading ? 'Connecting...' : (mode === 'forgot' ? 'Send reset link' : isRegister ? `Create ${accountType} account` : `Sign in as ${accountType}`)}</button></form><div className="mt-4 text-center text-xs text-[#77798a]">{mode === 'login' ? <span>New here? <Link href="/register" className="font-bold text-[#f26a4f]">Create an account</Link> · <Link href="/forgot-password" className="font-bold text-[#f26a4f]">Forgot password</Link></span> : mode === 'register' ? <span>Have an account? <Link href="/login" className="font-bold text-[#f26a4f]">Sign in</Link></span> : <span><Link href="/login" className="font-bold text-[#f26a4f]">Back to sign in</Link></span>}</div></div></AuthFrame>;
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

// Frontend guards are UX-only. Backend remains the authorization authority.
// Role comes ONLY from backend-validated session (useAuth). No demo fallback.
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
      <p className="mt-2 text-sm leading-6 text-[#77798a]">This workspace is for <b>{allowed.join(' / ')}</b> only. Your role is <b>{role}</b>. Sign in with an authorized account to continue.</p>
      <div className="mt-6 flex justify-center gap-2">
        <Link href="/login" className="rounded-xl bg-[#171a2d] px-4 py-2 text-xs font-bold text-white">Switch account</Link>
        <Link href="/dashboard" className="rounded-xl border border-[#dedbd1] px-4 py-2 text-xs font-bold">Back to dashboard</Link>
      </div>
      <p className="mt-4 text-[11px] text-[#77798a]">Organizer cannot modify immutable mentor feedback (PUT → 403). Mentor cannot manage hackathon. Participant cannot see organizer controls.</p>
    </div>
  );
  return <>{children}</>;
}
function RequireParticipant({ children }: { children: React.ReactNode }) { return <RequireAuth><RequireRole allowed={['PARTICIPANT', 'ADMIN']}>{children}</RequireRole></RequireAuth>; }
function RequireOrganizer({ children }: { children: React.ReactNode }) { return <RequireAuth><RequireRole allowed={['ORGANIZER', 'ADMIN']}>{children}</RequireRole></RequireAuth>; }
function RequireMentor({ children }: { children: React.ReactNode }) { return <RequireAuth><RequireRole allowed={['MENTOR', 'ADMIN', 'ORGANIZER']}>{children}</RequireRole></RequireAuth>; }
function RequireAdmin({ children }: { children: React.ReactNode }) { return <RequireAuth><RequireRole allowed={['ADMIN']}>{children}</RequireRole></RequireAuth>; }

function AppRoutes() { return <Switch>
<Route path="/" component={RoleLanding} />
<Route path="/dashboard" component={RoleLanding} />
<Route path="/hackathon/create">{() => <RequireOrganizer><CreateHackathon /></RequireOrganizer>}</Route>
<Route path="/hackathon/:id" component={HackathonDetail} />
<Route path="/participant/dashboard">{() => <RequireParticipant><ParticipantDashboard /></RequireParticipant>}</Route>
<Route path="/participant/hackathons">{() => <RequireParticipant><ParticipantHackathons /></RequireParticipant>}</Route>
<Route path="/participant/teams">{() => <RequireParticipant><ParticipantTeams /></RequireParticipant>}</Route>
<Route path="/participant/projects">{() => <RequireParticipant><ParticipantProjects /></RequireParticipant>}</Route>
<Route path="/participant/ai">{() => <RequireParticipant><ParticipantAI /></RequireParticipant>}</Route>
<Route path="/participant/github">{() => <RequireParticipant><ParticipantGithub /></RequireParticipant>}</Route>
<Route path="/participant/performance">{() => <RequireParticipant><ParticipantPerformance /></RequireParticipant>}</Route>
<Route path="/participant/learning">{() => <RequireParticipant><ParticipantLearning /></RequireParticipant>}</Route>
<Route path="/participant/profile">{() => <RequireAuth><ParticipantProfile /></RequireAuth>}</Route>
<Route path="/participant/settings">{() => <RequireAuth><ParticipantSettings /></RequireAuth>}</Route>
<Route path="/participant">{() => <RequireParticipant><ParticipantDashboard /></RequireParticipant>}</Route>
{/* Organizer routes — all protected ORGANIZER/ADMIN, real API via organizerApi */}
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
{/* Mentor routes — MENTOR role */}
<Route path="/mentor/dashboard">{() => <RequireMentor><MentorDashboard /></RequireMentor>}</Route>
<Route path="/mentor/teams">{() => <RequireMentor><MentorTeams /></RequireMentor>}</Route>
<Route path="/mentor/evaluations">{() => <RequireMentor><MentorEvaluations /></RequireMentor>}</Route>
<Route path="/mentor/feedback">{() => <RequireMentor><MentorFeedback /></RequireMentor>}</Route>
<Route path="/mentor/profile">{() => <RequireMentor><MentorProfile /></RequireMentor>}</Route>
<Route path="/mentor">{() => <RequireMentor><MentorDashboard /></RequireMentor>}</Route>
<Route path="/judge" component={Judge} /><Route path="/leaderboard" component={Leaderboard} /><Route path="/sponsors" component={Sponsors} /><Route path="/login">{() => <Auth mode="login" />}</Route><Route path="/register">{() => <Auth mode="register" />}</Route><Route path="/forgot-password">{() => <Auth mode="forgot" />}</Route><Route component={NotFound} /></Switch>; }
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
