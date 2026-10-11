import { ExternalLink } from 'lucide-react';
import type { IdeationCard, IdeationSpecialist } from '@/services/backendApi';

export const SPECIALISTS: Record<IdeationSpecialist, { emoji: string; name: string }> = {
  research: { emoji: '🔎', name: 'Research Scout' },
  market: { emoji: '📊', name: 'Market Gap Analyst' },
  devil: { emoji: '⚖️', name: "Devil's Advocate" },
  users: { emoji: '👥', name: 'User Voice' },
};

const FETCHING_SPECIALISTS = new Set<IdeationSpecialist>(['research', 'market']);

export function safeExternalUrl(url: string | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export function SpecialistCard({ card }: { card: IdeationCard }) {
  const specialist = SPECIALISTS[card.specialist] ?? { emoji: '🧠', name: 'Specialist' };
  const sources = card.sources ?? [];
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%] min-w-0 rounded-2xl border border-dashed border-[#cfcab9] bg-[#f4f1e8] px-4 py-3 text-sm text-[#171a2d]">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-base leading-none">{specialist.emoji}</span>
          <span className="font-bold">{specialist.name}</span>
          <span className="font-mono text-[9px] uppercase tracking-[.16em] text-[#77798a]">Specialist</span>
        </div>
        {card.title && <p className="mt-1 text-xs leading-5 text-[#55586a] [overflow-wrap:anywhere]">{card.title}</p>}
        {sources.length > 0 ? (
          <details className="group mt-2">
            <summary className="cursor-pointer text-xs font-bold text-[#171a2d] marker:text-[#f26a4f]">
              {sources.length} {sources.length === 1 ? 'source' : 'sources'}
            </summary>
            <ol className="mt-2 space-y-2">
              {sources.map((source, i) => {
                const href = safeExternalUrl(source.url);
                return (
                  <li key={`${i}-${source.url}`} className="flex gap-2 text-xs leading-5">
                    <span className="shrink-0 font-mono text-[#f26a4f]">[{i + 1}]</span>
                    <div className="min-w-0">
                      {href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="font-bold text-[#171a2d] underline decoration-[#dedbd1] underline-offset-2 hover:decoration-[#f26a4f] [overflow-wrap:anywhere]">
                          {source.title || href}
                          <ExternalLink size={11} className="ml-1 inline align-[-1px]" aria-hidden />
                          <span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      ) : (
                        <span className="font-bold [overflow-wrap:anywhere]">{source.title}</span>
                      )}
                      {source.meta && <div className="text-[#77798a] [overflow-wrap:anywhere]">{source.meta}</div>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </details>
        ) : (
          FETCHING_SPECIALISTS.has(card.specialist) && <p className="mt-2 text-xs text-[#77798a]">No sources found this time.</p>
        )}
      </div>
    </div>
  );
}
