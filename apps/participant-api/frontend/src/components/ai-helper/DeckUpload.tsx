import { useRef, useState } from 'react';
import { Loader2, Presentation } from 'lucide-react';
import type { IdeationDeckSlide } from '@/services/backendApi';
import { DECK_ACCEPT, DeckExtractError, DeckExtractor } from '@/lib/deck-extract';

export function DeckUpload({
  disabled,
  onDeck,
  onError,
}: {
  disabled: boolean;
  onDeck: (fileName: string, slides: IdeationDeckSlide[]) => void;
  onError: (message: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setReading(true);
    onError(null);
    try {
      onDeck(file.name, await DeckExtractor.extract(file));
    } catch (e) {
      onError(e instanceof DeckExtractError ? e.message : 'Could not read text from this file. Nothing was sent.');
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={DECK_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || reading}
        aria-label="Upload your deck for review (.pptx or .pdf, up to 15 MB)"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[#dedbd1] bg-white px-3 py-2 text-xs font-bold text-[#171a2d] hover:border-[#f26a4f] disabled:opacity-40"
      >
        {reading ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Presentation size={14} aria-hidden />}
        <span>{reading ? 'Reading…' : 'Deck'}</span>
      </button>
    </>
  );
}
