import { cn } from '@/lib/utils';
import type { IdeationPhase, IdeationPhaseChange } from '@/services/backendApi';

export function PhaseBanner({ change, phases }: { change: IdeationPhaseChange; phases: IdeationPhase[] }) {
  const advance = change.to > change.from;
  const title = phases[change.to - 1]?.title;
  return (
    <div
      className={cn(
        'mx-auto max-w-lg rounded-2xl border px-4 py-3 text-center',
        advance ? 'border-[#c9d34a] bg-[#f6f8d9]' : 'border-[#f5b3a4] bg-[#fdf0eb]',
      )}
    >
      <div className="font-mono text-[10px] uppercase tracking-[.16em] text-[#55586a]">{advance ? 'Phase unlocked' : 'Revisiting an earlier phase'}</div>
      <div className="mt-1 text-sm font-bold text-[#171a2d]">
        <span aria-hidden>{advance ? '🎉 ' : '↩ '}</span>
        {advance ? `On to phase ${change.to}` : `Back to phase ${change.to}`}
        {title ? ` · ${title}` : ''}
      </div>
      {change.reason && <p className="mt-1 text-xs leading-5 text-[#55586a] [overflow-wrap:anywhere]">{change.reason}</p>}
    </div>
  );
}
