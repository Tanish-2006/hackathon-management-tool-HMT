import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ShieldCheck, Loader2, ArrowRight, Check } from 'lucide-react';
import { hmtBackendService, ApiError } from '@/services/backendApi';
import { cn } from '@/lib/utils';

function friendly(e: unknown) { return e instanceof ApiError ? e.message : (e as Error)?.message || 'Failed'; }

const YEARS = ['1st Year', '2nd Year', '3rd Year', '4th Year', 'Graduate', 'Other'];
const E164 = /^\+[1-9]\d{7,14}$/;

export default function RegistrationForm({ hackathon, onRegistered }: { hackathon: any; onRegistered: (id: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    fullName: '', email: '', phone: '', phoneVerified: false,
    institution: '', institutionLocation: '', city: '', course: '', yearOfStudy: '', bio: '',
    languages: '', experience: 'INTERMEDIATE', eligibility: false,
  });
  const [otpOpen, setOtpOpen] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);

  useEffect(() => {
    let m = true;
    async function load() {
      setLoading(true);
      try {
        const [me, prof, sp] = await Promise.allSettled([
          hmtBackendService.getMe(), hmtBackendService.getProfile(), hmtBackendService.getSkillProfile(),
        ]);
        if (!m) return;
        const u: any = me.status === 'fulfilled' ? ((me.value as any)?.user || me.value) : null;
        const p: any = prof.status === 'fulfilled' ? prof.value : null;
        const d = p?.profile || p || {};
        const s: any = sp.status === 'fulfilled' ? sp.value : null;
        const skill = s?.skillProfile || s || {};
        setForm({
          fullName: d.fullName || u?.fullName || '',
          email: u?.email || '',
          phone: u?.phoneNumber || '',
          phoneVerified: !!u?.isPhoneVerified,
          institution: d.institution || '',
          institutionLocation: d.institutionLocation || '',
          city: d.city || '',
          course: d.course || '',
          yearOfStudy: d.yearOfStudy || '',
          bio: d.bio || '',
          languages: (skill.programmingLanguages || []).join(', '),
          experience: skill.experienceLevel || 'INTERMEDIATE',
          eligibility: false,
        });
      } catch (e) { if (m) setError(friendly(e)); }
      finally { if (m) setLoading(false); }
    }
    load();
    return () => { m = false; };
  }, []);

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!form.fullName.trim()) e.fullName = 'Full name is required.';
    if (!form.institution.trim()) e.institution = 'Institution is required.';
    if (!form.city.trim()) e.city = 'Your city is required.';
    if (form.phone && !E164.test(form.phone.trim())) e.phone = 'Phone must be in international format.';
    if (!form.languages.trim()) e.languages = 'Add at least one skill.';
    if (Array.isArray(hackathon?.eligibility) && hackathon.eligibility.length > 0 && !form.eligibility) {
      e.eligibility = 'Please confirm you meet the eligibility requirements.';
    }
    return e;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true); setError(null);
    try {
      await hmtBackendService.updateProfile({
        fullName: form.fullName.trim(),
        institution: form.institution.trim(),
        institutionLocation: form.institutionLocation.trim() || undefined,
        city: form.city.trim(),
        course: form.course.trim() || undefined,
        yearOfStudy: form.yearOfStudy || undefined,
        bio: form.bio.trim() || undefined,
      });
      await hmtBackendService.upsertSkillProfile({
        programmingLanguages: form.languages.split(',').map((s) => s.trim()).filter(Boolean),
        experienceLevel: form.experience,
      });
      await hmtBackendService.registerForHackathon(hackathon.id, {
        teamChoice: 'later',
        ...(Array.isArray(hackathon?.eligibility) && hackathon.eligibility.length > 0 ? { eligibilityAccepted: true } : {}),
      } as any);
      onRegistered(String(hackathon.id));
    } catch (e: any) {
      const msg = friendly(e);
      const code = (e as ApiError)?.code || '';
      if (code.includes('PHONE') || msg.includes('PHONE_VERIFICATION') || msg.includes('phone')) {
        setOtpOpen(true);
        setError('Verify your phone number to finish registering — request a code below.');
        return;
      }
      setError(msg);
    } finally { setSaving(false); }
  }

  async function sendOtp() {
    setOtpBusy(true);
    try {
      await hmtBackendService.requestPhoneOtp(form.phone.trim());
      setError('Code sent — enter it below.');
    } catch (e) { setError(friendly(e)); }
    finally { setOtpBusy(false); }
  }

  async function verifyOtp() {
    if (otp.trim().length !== 6) { setError('Enter the 6-digit code.'); return; }
    setOtpBusy(true);
    try {
      await hmtBackendService.verifyPhoneOtp(form.phone.trim(), otp.trim());
      setForm((f) => ({ ...f, phoneVerified: true }));
      setOtpOpen(false); setOtp('');
      setError(null);
    } catch (e) { setError(friendly(e)); }
    finally { setOtpBusy(false); }
  }

  if (loading) return <div className="animate-pulse rounded-xl bg-[#e9e5da] p-8 text-sm text-[#77798a]">Loading your information…</div>;

  const needsEligibility = Array.isArray(hackathon?.eligibility) && hackathon.eligibility.length > 0;
  const err = (k: string) => fieldErrors[k] && <span className="mt-1 block text-xs font-normal text-[#d74635]">{fieldErrors[k]}</span>;

  return (
    <form onSubmit={submit} className="rounded-xl bg-[#f4f1e8] p-4" noValidate>
      <div className="flex items-center gap-2 text-xs font-bold"><ShieldCheck size={14} className="text-[#5aafbd]" /> Register for {hackathon?.title}</div>
      <p className="mt-1 text-[11px] text-[#77798a]">Prefilled from your profile. Changes here update your profile too.</p>
      {error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold">Full name *<input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} maxLength={160} className="mt-1 w-full rounded-xl border border-[#dedbd1] bg-white px-3 py-2 text-sm outline-none"/>{err('fullName')}</label>
        <label className="block text-xs font-semibold">Email<input value={form.email} disabled className="mt-1 w-full rounded-xl border border-[#dedbd1] bg-[#e9e5da] px-3 py-2 text-sm text-[#77798a]"/></label>
        <label className="block text-xs font-semibold">Phone<input value={form.phone} disabled className="mt-1 w-full rounded-xl border border-[#dedbd1] bg-[#e9e5da] px-3 py-2 text-sm text-[#77798a]"/>{form.phoneVerified ? <span className="mt-1 block text-[11px] font-bold text-emerald-700">Verified</span> : <span className="mt-1 block text-[11px] font-bold text-[#f26a4f]">Unverified — verify below before submitting</span>}</label>
        <label className="block text-xs font-semibold">Institution *<input value={form.institution} onChange={(e) => set('institution', e.target.value)} maxLength={160} className="mt-1 w-full rounded-xl border border-[#dedbd1] bg-white px-3 py-2 text-sm outline-none"/>{err('institution')}</label>
        <label className="block text-xs font-semibold">Institution location<input value={form.institutionLocation} onChange={(e) => set('institutionLocation', e.target.value)} maxLength={160} className="mt-1 w-full rounded-xl border border-[#dedbd1] bg-white px-3 py-2 text-sm outline-none"/></label>
        <label className="block text-xs font-semibold">Your city *<input value={form.city} onChange={(e) => set('city', e.target.value)} maxLength={120} className="mt-1 w-full rounded-xl border border-[#dedbd1] bg-white px-3 py-2 text-sm outline-none"/>{err('city')}</label>
        <label className="block text-xs font-semibold">Course / department<input value={form.course} onChange={(e) => set('course', e.target.value)} maxLength={120} className="mt-1 w-full rounded-xl border border-[#dedbd1] bg-white px-3 py-2 text-sm outline-none"/></label>
        <label className="block text-xs font-semibold">Year of study<select value={form.yearOfStudy} onChange={(e) => set('yearOfStudy', e.target.value)} className="mt-1 w-full rounded-xl border border-[#dedbd1] bg-white px-3 py-2 text-sm"><option value="">Select…</option>{YEARS.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
      </div>
      <label className="mt-3 block text-xs font-semibold">Bio (optional)<textarea value={form.bio} onChange={(e) => set('bio', e.target.value)} rows={2} maxLength={1000} className="mt-1 w-full resize-none rounded-xl border border-[#dedbd1] bg-white px-3 py-2 text-sm outline-none"/></label>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold">Skills *<input value={form.languages} onChange={(e) => set('languages', e.target.value)} placeholder="e.g. Design, Python, Marketing" className="mt-1 w-full rounded-xl border border-[#dedbd1] bg-white px-3 py-2 text-sm outline-none"/>{err('languages')}</label>
        <label className="block text-xs font-semibold">Experience<select value={form.experience} onChange={(e) => set('experience', e.target.value)} className="mt-1 w-full rounded-xl border border-[#dedbd1] bg-white px-3 py-2 text-sm"><option>BEGINNER</option><option>INTERMEDIATE</option><option>ADVANCED</option><option>EXPERT</option></select></label>
      </div>
      {needsEligibility && (
        <label className={cn('mt-3 flex items-start gap-2 rounded-xl border bg-white p-3 text-xs', fieldErrors.eligibility ? 'border-red-300' : 'border-[#dedbd1]')}>
          <input type="checkbox" checked={!!form.eligibility} onChange={(e) => set('eligibility', e.target.checked)} className="mt-0.5" />
          <span><b>Eligibility confirmation *</b> — I confirm I meet: {(hackathon.eligibility as string[]).join(', ')}. {err('eligibility')}</span>
        </label>
      )}

      {(otpOpen || !form.phoneVerified) && form.phone && (
        <div className="mt-3 rounded-xl border border-[#dedbd1] bg-white p-3">
          <div className="text-xs font-bold">Verify {form.phone}</div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={sendOtp} disabled={otpBusy} className="rounded-xl border border-[#dedbd1] px-3 py-2 text-xs font-bold disabled:opacity-60">{otpBusy ? 'Sending…' : 'Send code'}</button>
            <input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="6-digit code" inputMode="numeric" maxLength={6} className="flex-1 rounded-xl border border-[#dedbd1] px-3 py-2 text-xs outline-none" />
            <button type="button" onClick={verifyOtp} disabled={otpBusy} className="rounded-xl bg-[#171a2d] px-3 py-2 text-xs font-bold text-white disabled:opacity-60">{otpBusy ? 'Verifying…' : 'Verify'}</button>
          </div>
        </div>
      )}

      <button type="submit" disabled={saving} className="mt-4 w-full rounded-xl bg-[#f26a4f] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60">{saving ? 'Saving & registering…' : 'Save information & register'}</button>
      <Link href="/participant/profile" className="mt-2 block text-center text-[11px] font-semibold text-[#5aafbd] underline">Edit full profile instead</Link>
    </form>
  );
}
