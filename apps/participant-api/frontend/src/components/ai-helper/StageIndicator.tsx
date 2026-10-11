import { Loader2 } from 'lucide-react';
import type { IdeationStage } from '@/services/backendApi';
import { SPECIALISTS } from '@/components/ai-helper/SpecialistCard';

const STAGE_LABELS: Record<IdeationStage, string> = {
  routing: 'Thinking…',
  research: 'Research Scout is searching papers…',
  market: 'Market Gap Analyst is scanning the market…',
  devil: "Devil's Advocate is stress-testing your idea…",
  users: 'User Voice is stepping into your users’ shoes…',
  writing: 'Writing…',
  reading: 'Reading your slides…',
};

export function StageIndicator({ stage }: { stage: IdeationStage | null }) {
  const emoji = stage && stage in SPECIALISTS ? SPECIALISTS[stage as keyof typeof SPECIALISTS].emoji : null;
  return (
    <div className="flex justify-start">
      <div role="status" aria-live="polite" className="inline-flex items-center gap-2 rounded-2xl border border-[#e5e1d7] bg-white px-4 py-2.5 text-xs font-semibold text-[#55586a]">
        {emoji ? <span aria-hidden>{emoji}</span> : <Loader2 size={13} className="animate-spin text-[#f26a4f]" aria-hidden />}
        {STAGE_LABELS[stage ?? 'routing'] ?? STAGE_LABELS.routing}
        {emoji && <Loader2 size={12} className="animate-spin text-[#f26a4f]" aria-hidden />}
      </div>
    </div>
  );
}
