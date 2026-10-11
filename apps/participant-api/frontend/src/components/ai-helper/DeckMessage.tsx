import { FileText } from 'lucide-react';
import type { IdeationDeckInfo } from '@/services/backendApi';
import { UserRow } from '@/components/ai-helper/MessageBubble';

export function DeckMessage({ deck, authorName, mine }: { deck: IdeationDeckInfo; authorName: string | null | undefined; mine: boolean }) {
  return (
    <UserRow name={authorName} mine={mine}>
      <div className="flex max-w-full items-center gap-3 rounded-2xl border border-[#dedbd1] bg-white px-3 py-2.5 text-[#171a2d]">
        <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#fdf0eb] text-[#f26a4f]">
          <FileText size={18} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold" title={deck.fileName}>{deck.fileName}</div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-[#77798a]">
            Deck for review · {deck.slideCount} {deck.slideCount === 1 ? 'slide' : 'slides'}
          </div>
        </div>
      </div>
    </UserRow>
  );
}
