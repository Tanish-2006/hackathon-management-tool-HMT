import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { AlertCircle, ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { hmtBackendService, ApiError } from '@/services/backendApi';
import ParticipantAI from '@/pages/participant/ai';

function friendly(e: unknown) {
  return e instanceof ApiError ? e.message : (e as Error)?.message || 'Failed';
}

/**
 * Hackathon-scoped AI Teammate workspace.
 * Route: /participant/my-hackathons/:id/ai
 *
 * The :id is the authority for hackathon/team/project context. Registration
 * is verified here for UX messaging, but the backend remains authoritative —
 * every AI request re-validates membership, project ownership, live window,
 * and repository grants against the supplied hackathon scope.
 */
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

/**
 * Legacy global route handler: /participant/ai
 *
 * The global AI workspace no longer exists. When exactly one registration
 * exists the participant is sent to that hackathon's AI workspace;
 * otherwise an explanatory message with workspace links is shown.
 * No AI content is served here, so no unscoped context can leak.
 */
export function LegacyAIRedirect() {
  const [, setLocation] = useLocation();
  const [state, setState] = useState<{ loading: boolean; regs: any[]; error: string | null }>({
    loading: true,
    regs: [],
    error: null,
  });

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const [regs, mine] = await Promise.allSettled([
          hmtBackendService.getMyRegistrations().catch(() => []),
          hmtBackendService.getMyHackathons().catch(() => ({ data: [] })),
        ]);
        if (!mounted) return;
        const regList =
          regs.status === 'fulfilled'
            ? Array.isArray(regs.value)
              ? regs.value
              : ((regs.value as any)?.data ?? [])
            : [];
        const rows =
          mine.status === 'fulfilled'
            ? (((mine.value as any)?.data ?? mine.value ?? []) as any[])
            : [];
        const titles: Record<string, string> = {};
        for (const r of Array.isArray(rows) ? rows : [])
          titles[String(r.id)] = String(r.title ?? 'Hackathon');
        const merged = regList.map((r: any) => ({
          hackathonId: String(r.hackathonId),
          title: titles[String(r.hackathonId)] ?? 'Hackathon',
        }));
        setState({ loading: false, regs: merged, error: null });
        if (merged.length === 1 && merged[0]?.hackathonId) {
          setLocation(`/participant/my-hackathons/${merged[0].hackathonId}/ai`);
        }
      } catch (e) {
        if (mounted) setState({ loading: false, regs: [], error: friendly(e) });
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [setLocation]);

  if (state.loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#77798a]">
        <Loader2 size={16} className="animate-spin" /> Finding your hackathon workspace…
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 flex gap-3">
        <AlertCircle size={18} />
        <div>
          <b>Could not load workspaces</b>
          <p className="mt-1">{state.error}</p>
          <Link
            href="/participant/my-hackathons"
            className="mt-3 inline-block text-xs font-bold underline"
          >
            Go to My Hackathons
          </Link>
        </div>
      </div>
    );
  }

  if (state.regs.length === 0) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-8 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#171a2d] text-[#d8e35b]">
          <Sparkles size={22} />
        </div>
        <h1 className="mt-4 text-xl font-bold">AI Teammate moved into hackathon workspaces</h1>
        <p className="mt-2 text-sm leading-6 text-[#77798a]">
          There is no global AI workspace anymore. Register for a hackathon and open AI Teammate
          inside its workspace — it answers with your team and project context.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Link
            href="/participant/hackathons"
            className="rounded-xl bg-[#f26a4f] px-4 py-2 text-xs font-bold text-white"
          >
            Discover hackathons
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

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-8">
      <h1 className="text-xl font-bold">Choose your hackathon workspace</h1>
      <p className="mt-2 text-sm leading-6 text-[#77798a]">
        AI Teammate is scoped to one hackathon at a time — each workspace keeps its own team,
        project, and history. Pick where to continue.
      </p>
      <div className="mt-5 space-y-2">
        {state.regs.map((r) => (
          <Link
            key={r.hackathonId}
            href={`/participant/my-hackathons/${r.hackathonId}/ai`}
            className="flex items-center justify-between rounded-xl border border-[#e5e1d7] bg-white px-4 py-3 text-sm font-bold hover:border-[#f26a4f]"
          >
            <span className="inline-flex items-center gap-2">
              <Sparkles size={15} className="text-[#f26a4f]" /> {r.title}
            </span>
            <ArrowRight size={15} className="text-[#77798a]" />
          </Link>
        ))}
      </div>
      <Link
        href="/participant/my-hackathons"
        className="mt-5 inline-block text-xs font-bold text-[#77798a] underline"
      >
        Back to My Hackathons
      </Link>
    </div>
  );
}

export default ParticipantHackathonAI;
