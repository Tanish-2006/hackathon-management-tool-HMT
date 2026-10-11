import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, Send, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';

const MAX_TEXTAREA_HEIGHT = 200;

export function useCountdown(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      const next = Date.now();
      setNow(next);
      if (next >= until) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  maxChars,
  streaming,
  cooldownSeconds,
  placeholder,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  maxChars: number;
  streaming: boolean;
  cooldownSeconds: number;
  placeholder: string;
  children?: ReactNode;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wasStreaming = useRef(streaming);
  const canSend = !streaming && cooldownSeconds === 0 && value.trim().length > 0;

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [value]);

  useEffect(() => {
    if (wasStreaming.current && !streaming) textareaRef.current?.focus({ preventScroll: true });
    wasStreaming.current = streaming;
  }, [streaming]);

  function submit() {
    if (canSend) onSubmit();
  }

  return (
    <form
      className="border-t border-[#e5e1d7] p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, maxChars))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        rows={2}
        maxLength={maxChars}
        disabled={streaming}
        placeholder={placeholder}
        aria-label="Message the AI coach"
        aria-describedby="ai-helper-composer-status"
        className="block max-h-[200px] w-full resize-none rounded-xl border border-[#dedbd1] bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-[#f26a4f] disabled:bg-[#f4f1e8] disabled:opacity-70"
      />
      <div className="mt-2 flex items-center gap-2">
        {children}
        <div id="ai-helper-composer-status" className="min-w-0 flex-1 text-[11px] leading-4 text-[#77798a]" aria-live="polite">
          {cooldownSeconds > 0 ? (
            <span className="inline-flex items-center gap-1 font-bold text-[#c2492f]">
              <Timer size={12} aria-hidden /> You can send again in {cooldownSeconds}s
            </span>
          ) : streaming ? (
            <span>The coach is replying…</span>
          ) : (
            <span className="hidden sm:inline">Enter to send · Shift+Enter for a new line</span>
          )}
        </div>
        <span className={cn('shrink-0 font-mono text-[10px]', value.length >= maxChars * 0.9 ? 'text-[#c2492f]' : 'text-[#9b9fb1]')}>
          <span aria-hidden>{value.length}/{maxChars}</span>
          <span className="sr-only">{value.length} of {maxChars} characters used</span>
        </span>
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send message"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[#f26a4f] px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
        >
          {streaming ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Send size={14} aria-hidden />}
          <span className="hidden sm:inline">Send</span>
        </button>
      </div>
    </form>
  );
}
