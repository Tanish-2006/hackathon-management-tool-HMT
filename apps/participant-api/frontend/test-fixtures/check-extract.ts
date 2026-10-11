import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { GlobalWorkerOptions } from 'pdfjs-dist';
import { DeckExtractor, DeckExtractError, EMPTY_SLIDE_TEXT } from '../src/lib/deck-extract.ts';

GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/build/pdf.worker.min.mjs');
const fixture = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(name, import.meta.url))));

const pptx = await DeckExtractor.fromPptx(fixture('sample-deck.pptx'));
assert.deepEqual(pptx, [
  { index: 1, title: 'Campus Food Rescue', text: 'Problem: 30% of hostel meals are thrown away\nStudents & mess staff confirm it' },
  { index: 2, title: 'Who has this problem', text: 'Hostel mess managers\nNGOs collecting surplus food\nSpeaker notes: Interviewed 12 managers last week' },
  { index: 3, title: '', text: EMPTY_SLIDE_TEXT },
]);

const pdf = await DeckExtractor.fromPdf(fixture('sample-deck.pdf'));
assert.deepEqual(pdf, [
  { index: 1, title: 'Campus Food Rescue', text: 'Problem: hostel meals are wasted every night' },
  { index: 2, title: 'Pilot plan', text: 'Two hostels, four weeks, measure kg saved' },
]);

const slide = (index: number, text: string) => ({ index, title: '', text });
assert.throws(() => DeckExtractor.validate(Array.from({ length: 61 }, (_, i) => slide(i + 1, 'x'))), DeckExtractError);
assert.throws(() => DeckExtractor.validate([slide(1, 'x'.repeat(24001))]), DeckExtractError);
assert.throws(() => DeckExtractor.validate([slide(1, EMPTY_SLIDE_TEXT)]), DeckExtractError);
assert.equal(DeckExtractor.validate(pptx), pptx);
console.log('deck extraction ok', { pptx: pptx.length, pdf: pdf.length });
