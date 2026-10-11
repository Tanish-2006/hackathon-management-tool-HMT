const DOT_DELAYS_MS = [0, 160, 320];

function label(names: string[]) {
  if (names.length === 1) return `${names[0]} is typing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
  return `${names.length} teammates are typing`;
}

export function TypingIndicator({ names }: { names: string[] }) {
  if (!names.length) return null;
  return (
    <div className="flex justify-start" data-testid="status-typing">
      <div role="status" aria-live="polite" className="inline-flex items-center gap-2.5 rounded-2xl border border-[#e5e1d7] bg-white px-4 py-2.5 text-xs font-semibold text-[#55586a]">
        <span className="flex h-3 items-end gap-1" aria-hidden>
          {DOT_DELAYS_MS.map((delay) => (
            <span key={delay} className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#5aafbd]" style={{ animationDelay: `${delay}ms` }} />
          ))}
        </span>
        {label(names)}…
      </div>
    </div>
  );
}
