import { Fragment, type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { IdeationSource } from '@/services/backendApi';
import { safeExternalUrl } from '@/components/ai-helper/SpecialistCard';

type Block = { type: 'paragraph' | 'list' | 'heading'; lines: string[] };

export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0]?.slice(0, 2) ?? '?').toUpperCase();
}

function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) {
      current = null;
      continue;
    }
    const bullet = line.match(/^[-•*]\s+(.*)$/);
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    const type: Block['type'] = bullet ? 'list' : heading ? 'heading' : 'paragraph';
    if (type === 'heading' || current?.type !== type) {
      current = { type, lines: [] };
      blocks.push(current);
    }
    current.lines.push(bullet?.[1] ?? heading?.[1] ?? line);
  }
  return blocks;
}

function Inline({ text, sources }: { text: string; sources: IdeationSource[] }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|\[\d+\])/g).map((part, i) => {
        const bold = part.match(/^\*\*([^*]+)\*\*$/);
        if (bold) return <strong key={i}>{bold[1]}</strong>;
        const citation = part.match(/^\[(\d+)\]$/);
        const source = citation ? sources[Number(citation[1]) - 1] : undefined;
        const href = safeExternalUrl(source?.url);
        if (citation && href) {
          return (
            <a
              key={i}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title={source.title}
              aria-label={`Source ${citation[1]}: ${source.title} (opens in a new tab)`}
              className="mx-0.5 rounded bg-[#fdf0eb] px-1 font-mono text-[11px] font-bold text-[#c2492f] no-underline hover:bg-[#f26a4f] hover:text-white"
            >
              [{citation[1]}]
            </a>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

export function RichText({ text, sources = [] }: { text: string; sources?: IdeationSource[] }) {
  return (
    <div className="space-y-2">
      {toBlocks(text).map((block, i) => {
        if (block.type === 'list') {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5 marker:text-[#f26a4f]">
              {block.lines.map((line, j) => <li key={j}><Inline text={line} sources={sources} /></li>)}
            </ul>
          );
        }
        if (block.type === 'heading') return <p key={i} className="font-bold"><Inline text={block.lines[0]} sources={sources} /></p>;
        return (
          <p key={i}>
            {block.lines.map((line, j) => (
              <Fragment key={j}>{j > 0 && <br />}<Inline text={line} sources={sources} /></Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

export function Avatar({ name, mine }: { name: string | null | undefined; mine: boolean }) {
  return (
    <span aria-hidden className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold', mine ? 'bg-[#d8e35b] text-[#171a2d]' : 'bg-[#e9e5da] text-[#55586a]')}>
      {initialsOf(name)}
    </span>
  );
}

export function UserRow({ name, mine, children }: { name: string | null | undefined; mine: boolean; children: ReactNode }) {
  return (
    <div className={cn('flex items-end gap-2', mine && 'flex-row-reverse')}>
      <Avatar name={name} mine={mine} />
      <div className={cn('flex min-w-0 max-w-[85%] flex-col gap-1', mine ? 'items-end' : 'items-start')}>
        <span className="px-1 text-[11px] font-bold text-[#77798a]">{name || (mine ? 'You' : 'Teammate')}</span>
        {children}
      </div>
    </div>
  );
}

export function MessageBubble({
  kind,
  content,
  authorName,
  mine = false,
  sources,
  streaming = false,
}: {
  kind: 'user' | 'assistant';
  content: string;
  authorName?: string | null;
  mine?: boolean;
  sources?: IdeationSource[];
  streaming?: boolean;
}) {
  if (kind === 'user') {
    return (
      <UserRow name={authorName} mine={mine}>
        <div className={cn('rounded-2xl px-4 py-2.5 text-sm leading-6 whitespace-pre-wrap [overflow-wrap:anywhere]', mine ? 'rounded-br-md bg-[#171a2d] text-[#fdfbf5]' : 'rounded-bl-md bg-[#f4f1e8] text-[#171a2d]')}>
          {content}
        </div>
      </UserRow>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="min-w-0 max-w-[92%] rounded-2xl rounded-tl-md border border-[#e5e1d7] bg-white px-4 py-3 text-sm leading-6 text-[#171a2d] [overflow-wrap:anywhere] sm:max-w-[85%]">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#f26a4f]">
          <Sparkles size={11} aria-hidden /> AI Coach
        </div>
        <RichText text={content} sources={sources} />
        {streaming && <span aria-hidden className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-[#f26a4f] align-[-2px]" />}
      </div>
    </div>
  );
}
