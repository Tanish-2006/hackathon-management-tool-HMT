import { Check, Lock, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { IdeationPhase } from '@/services/backendApi';

type StepStatus = 'done' | 'current' | 'locked';

const STATUS_LABEL: Record<StepStatus, string> = { done: 'done', current: 'current phase', locked: 'locked' };

export function PhaseProgress({ phases, current }: { phases: IdeationPhase[]; current: number }) {
  const phase = phases[current - 1];
  return (
    <section aria-label="Ideation progress" className="space-y-3">
      <ol className="grid grid-cols-6 gap-1.5 sm:gap-2">
        {phases.map((p, i) => {
          const n = i + 1;
          const status: StepStatus = n < current ? 'done' : n === current ? 'current' : 'locked';
          return (
            <li
              key={n}
              aria-current={status === 'current' ? 'step' : undefined}
              aria-label={`Phase ${n}: ${p.title}, ${STATUS_LABEL[status]}`}
              className={cn(
                'flex min-w-0 flex-col items-center gap-1.5 rounded-xl border p-1.5 sm:items-start sm:p-3',
                status === 'current' && 'border-[#f26a4f] bg-white shadow-sm',
                status === 'done' && 'border-[#dedbd1] bg-[#f4f1e8]',
                status === 'locked' && 'border-dashed border-[#dedbd1] opacity-60',
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    'grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold',
                    status === 'current' && 'bg-[#f26a4f] text-white',
                    status === 'done' && 'bg-[#d8e35b] text-[#171a2d]',
                    status === 'locked' && 'bg-[#e9e5da] text-[#77798a]',
                  )}
                >
                  {status === 'done' ? <Check size={13} /> : status === 'locked' ? <Lock size={11} /> : n}
                </span>
                <span className="hidden font-mono text-[10px] uppercase tracking-wider text-[#77798a] lg:inline">Phase {n}</span>
              </span>
              <span className="hidden text-xs font-bold leading-4 text-[#171a2d] sm:line-clamp-2">{p.title}</span>
            </li>
          );
        })}
      </ol>
      {phase && (
        <div className="rounded-2xl border border-[#dedbd1] bg-[#fdfbf5] p-4">
          <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#f26a4f]">
            Now · Phase {current} of {phases.length} · {phase.title}
          </div>
          <p className="mt-2 text-sm leading-6 text-[#171a2d]">{phase.goal}</p>
          {phase.exitCheck && (
            <div className="mt-3 flex gap-2 rounded-xl bg-[#f4f1e8] px-3 py-2 text-xs leading-5 text-[#55586a]">
              <Target size={14} className="mt-0.5 shrink-0 text-[#171a2d]" aria-hidden />
              <p><b className="text-[#171a2d]">What the coach is checking:</b> {phase.exitCheck}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
