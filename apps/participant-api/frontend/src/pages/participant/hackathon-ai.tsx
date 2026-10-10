import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { hmtBackendService, ApiError } from '@/services/backendApi';
import ParticipantAI from '@/pages/participant/ai';

function friendly(e: unknown) {
  return e instanceof ApiError ? e.message : (e as Error)?.message || 'Failed';
}

export function ParticipantHackathonAI() {
  const { id } = useParams<{ id: string }>();
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function check() {
      if (!id) {
        if (mounted) {
          setRegistered(false);
          setChecking(false);
        }
        return;
      }
      setChecking(true);
      setError(null);
      try {
        const regs: any = await hmtBackendService.getMyRegistrations().catch(() => []);
        const list = Array.isArray(regs) ? regs : (regs?.data ?? []);
        if (mounted) setRegistered(list.some((r: any) => String(r.hackathonId) === String(id)));
      } catch (e) {
        if (mounted) setError(friendly(e));
      } finally {
        if (mounted) setChecking(false);
      }
    }
    check();
    return () => {
      mounted = false;
    };
  }, [id]);

  if (!id) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-8 text-center">
        <h1 className="text-xl font-bold">Hackathon workspace not found</h1>
        <p className="mt-2 text-sm leading-6 text-[#77798a]">
          Open AI Teammate from a registered hackathon instead.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Link
            href="/participant/my-hackathons"
            className="rounded-xl bg-[#171a2d] px-4 py-2 text-xs font-bold text-white"
          >
            My Hackathons
          </Link>
          <Link
            href="/participant/hackathons"
            className="rounded-xl border border-[#dedbd1] px-4 py-2 text-xs font-bold"
          >
            Discover
          </Link>
        </div>
      </div>
    );
  }

  if (checking) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#77798a]">
        <Loader2 size={16} className="animate-spin" /> Verifying hackathon workspace…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        <b>Could not verify registration</b>
        <p className="mt-1">{error}</p>
        <Link
          href="/participant/my-hackathons"
          className="mt-4 inline-flex items-center gap-1 text-xs font-bold underline"
        >
          Back to My Hackathons <ArrowRight size={13} />
        </Link>
      </div>
    );
  }

  if (!registered) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-8 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#171a2d] text-[#d8e35b]">
          <Sparkles size={22} />
        </div>
        <h1 className="mt-4 text-xl font-bold">Register to unlock AI Teammate</h1>
        <p className="mt-2 text-sm leading-6 text-[#77798a]">
          AI Teammate works inside a hackathon you registered for — it needs your team and project
          context. This workspace is private to its participants.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Link
            href="/participant/hackathons"
            className="rounded-xl bg-[#f26a4f] px-4 py-2 text-xs font-bold text-white"
          >
            Discover & register
          </Link>
          <Link
            href="/participant/my-hackathons"
            className="rounded-xl border border-[#dedbd1] px-4 py-2 text-xs font-bold"
          >
            My Hackathons
          </Link>
        </div>
      </div>
    );
  }

  return <ParticipantAI hackathonId={id} />;
}
