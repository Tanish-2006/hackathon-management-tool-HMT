import { useCallback, useEffect, useState } from 'react';
import { hmtBackendService } from '@/services/backendApi';

const STORAGE_KEY = 'hmt_selected_hackathon';

function readStored(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const v = localStorage.getItem(STORAGE_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeStored(id: string | null) {
  try {
    if (typeof window === 'undefined') return;
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // persistence is best-effort; context still works in-memory
  }
}

export interface HackathonOption {
  id: string;
  title: string;
  registered: boolean;
}

/**
 * Shared hackathon context for participant pages.
 *
 * A participant's team/project/progress are scoped to ONE hackathon, but the
 * backend "current hackathon" is a global pick and legacy /team/me +
 * /project/me are global. This hook resolves the effective context:
 * persisted selection (when still registered) → current-if-registered →
 * first registration → current (unregistered preview) → null.
 *
 * Stale selections (unregistered/deleted hackathons) fall back automatically
 * so one hackathon's team is never displayed as another's.
 */
export function useHackathonContext() {
  const [current, setCurrent] = useState<any | null>(null);
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const [h, regs] = await Promise.allSettled([
          hmtBackendService.getCurrentHackathon().catch(() => null),
          hmtBackendService.getMyRegistrations().catch(() => []),
        ]);
        if (!mounted) return;
        const cur = h.status === 'fulfilled' ? (h.value as any) : null;
        const list = regs.status === 'fulfilled'
          ? (Array.isArray(regs.value) ? regs.value : ((regs.value as any)?.data ?? []))
          : [];
        setCurrent(cur && cur.id ? cur : null);
        setRegistrations(Array.isArray(list) ? list : []);

        const regIds = new Set((Array.isArray(list) ? list : []).map((r: any) => String(r.hackathonId)));
        const stored = readStored();
        let next: string | null = null;
        if (stored && regIds.has(stored)) next = stored;
        else if (cur?.id && regIds.has(String(cur.id))) next = String(cur.id);
        else if (list.length) next = String(list[0].hackathonId);
        else next = cur?.id ? String(cur.id) : null;
        setSelectedId(next);

        // Resolve titles for registered hackathons (bounded: registrations are few).
        const missing = (Array.isArray(list) ? list : [])
          .map((r: any) => String(r.hackathonId))
          .filter((id: string) => id !== String(cur?.id));
        if (missing.length) {
          const entries = await Promise.allSettled(
            missing.slice(0, 10).map((id: string) =>
              hmtBackendService.getHackathonById(id).catch(() => null),
            ),
          );
          if (!mounted) return;
          const map: Record<string, string> = {};
          entries.forEach((e, i) => {
            if (e.status === 'fulfilled' && (e.value as any)?.id) {
              const v: any = e.value;
              map[String(v.id)] = String(v.title || v.name || 'Hackathon');
            } else {
              map[String(missing[i])] = 'Hackathon';
            }
          });
          setTitles(map);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    writeStored(id);
  }, []);

  const registeredIds = new Set(registrations.map((r: any) => String(r.hackathonId)));
  const isRegistered = useCallback(
    (id?: string | null) => {
      const target = id ?? selectedId;
      return !!target && registeredIds.has(String(target));
    },
    [selectedId, registrations],
  );

  const options: HackathonOption[] = (() => {
    const seen = new Set<string>();
    const out: HackathonOption[] = [];
    for (const r of registrations) {
      const id = String(r.hackathonId);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        title: id === String(current?.id) ? String(current.title || current.name || 'Hackathon') : (titles[id] || 'Hackathon'),
        registered: true,
      });
    }
    if (current?.id && !seen.has(String(current.id))) {
      out.push({ id: String(current.id), title: String(current.title || current.name || 'Hackathon'), registered: false });
    }
    return out;
  })();

  const selectedHackathon =
    selectedId && current && String(current.id) === String(selectedId) ? current : null;

  return {
    current,
    registrations,
    registeredIds,
    hasRegistrations: registrations.length > 0,
    selectedId,
    select,
    selectedHackathon,
    selectedTitle:
      selectedId === null
        ? null
        : (options.find((o) => o.id === selectedId)?.title ?? null),
    selectedIsRegistered: isRegistered(),
    isRegistered,
    options,
    loading,
  };
}
