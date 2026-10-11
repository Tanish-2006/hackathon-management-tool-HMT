import type { IdeationDeckSlide } from '@/services/backendApi';

export const DECK_LIMITS = { maxBytes: 15 * 1024 * 1024, maxSlides: 60, maxChars: 24000 };
export const DECK_ACCEPT = '.pptx,.pdf';
export const EMPTY_SLIDE_TEXT = '(no text)';

const TITLE_PLACEHOLDERS = new Set(['title', 'ctrTitle']);
const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export class DeckExtractError extends Error {}

type ZipArchive = { file(path: string): { async(type: 'string'): Promise<string> } | null; files: Record<string, unknown> };

export class DeckExtractor {
  static async extract(file: File): Promise<IdeationDeckSlide[]> {
    const extension = file.name.toLowerCase().split('.').pop();
    if (extension !== 'pptx' && extension !== 'pdf') throw new DeckExtractError('Upload a .pptx or .pdf file.');
    if (file.size > DECK_LIMITS.maxBytes) throw new DeckExtractError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 15 MB.`);
    const data = await file.arrayBuffer();
    const slides = extension === 'pptx' ? await DeckExtractor.fromPptx(data) : await DeckExtractor.fromPdf(data);
    return DeckExtractor.validate(slides);
  }

  static validate(slides: IdeationDeckSlide[]): IdeationDeckSlide[] {
    if (!slides.length) throw new DeckExtractError('This file has no slides.');
    if (slides.length > DECK_LIMITS.maxSlides) throw new DeckExtractError(`This deck has ${slides.length} slides. The limit is ${DECK_LIMITS.maxSlides}.`);
    if (slides.every((slide) => !slide.title && slide.text === EMPTY_SLIDE_TEXT)) throw new DeckExtractError('No text found in this deck. Image-only slides cannot be reviewed.');
    const totalChars = slides.reduce((sum, slide) => sum + slide.title.length + slide.text.length, 0);
    if (totalChars > DECK_LIMITS.maxChars) throw new DeckExtractError(`This deck has ${totalChars.toLocaleString('en-IN')} characters of text. The limit is ${DECK_LIMITS.maxChars.toLocaleString('en-IN')}; trim long slides or notes.`);
    return slides;
  }

  static async fromPptx(data: ArrayBuffer | Uint8Array): Promise<IdeationDeckSlide[]> {
    const { default: JSZip } = await import('jszip');
    let zip: ZipArchive;
    try {
      zip = await JSZip.loadAsync(data);
    } catch {
      throw new DeckExtractError('This .pptx file could not be opened. Re-export it and try again.');
    }
    const slideNumbers = Object.keys(zip.files)
      .map((path) => path.match(/^ppt\/slides\/slide(\d+)\.xml$/)?.[1])
      .filter(Boolean)
      .map(Number)
      .sort((a, b) => a - b);
    if (slideNumbers.length > DECK_LIMITS.maxSlides) throw new DeckExtractError(`This deck has ${slideNumbers.length} slides. The limit is ${DECK_LIMITS.maxSlides}.`);
    return Promise.all(slideNumbers.map((number, position) => DeckExtractor.readPptxSlide(zip, number, position + 1)));
  }

  static async fromPdf(data: ArrayBuffer | Uint8Array): Promise<IdeationDeckSlide[]> {
    const pdfjs = await import('pdfjs-dist');
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    }
    let document: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
    try {
      document = await pdfjs.getDocument({ data: data instanceof Uint8Array ? data : new Uint8Array(data) }).promise;
    } catch {
      throw new DeckExtractError('This PDF could not be opened. It may be damaged or password-protected.');
    }
    try {
      if (document.numPages > DECK_LIMITS.maxSlides) throw new DeckExtractError(`This deck has ${document.numPages} pages. The limit is ${DECK_LIMITS.maxSlides}.`);
      const pageNumbers = Array.from({ length: document.numPages }, (_, i) => i + 1);
      return await Promise.all(
        pageNumbers.map(async (index) => {
          const content = await (await document.getPage(index)).getTextContent();
          const text = content.items
            .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''))
            .join('');
          const [title = '', ...rest] = DeckExtractor.lines(text);
          return { index, title, text: rest.join('\n') || EMPTY_SLIDE_TEXT };
        }),
      );
    } finally {
      document.destroy();
    }
  }

  private static async readPptxSlide(zip: ZipArchive, number: number, index: number): Promise<IdeationDeckSlide> {
    const xml = (await zip.file(`ppt/slides/slide${number}.xml`)?.async('string')) ?? '';
    let title = '';
    const body: string[] = [];
    for (const shape of DeckExtractor.shapes(xml)) {
      const text = DeckExtractor.shapeText(shape);
      if (!text) continue;
      if (!title && TITLE_PLACEHOLDERS.has(DeckExtractor.placeholderType(shape) ?? '')) title = text.replace(/\n/g, ' ');
      else body.push(text);
    }
    const notes = await DeckExtractor.readPptxNotes(zip, number);
    const text = [body.join('\n'), notes && `Speaker notes: ${notes}`].filter(Boolean).join('\n');
    return { index, title, text: text || EMPTY_SLIDE_TEXT };
  }

  private static async readPptxNotes(zip: ZipArchive, slideNumber: number): Promise<string> {
    const rels = (await zip.file(`ppt/slides/_rels/slide${slideNumber}.xml.rels`)?.async('string')) ?? '';
    const target = rels.match(/Target="(?:\.\.\/notesSlides\/|\/ppt\/notesSlides\/)(notesSlide\d+\.xml)"/)?.[1];
    if (!target) return '';
    const xml = (await zip.file(`ppt/notesSlides/${target}`)?.async('string')) ?? '';
    return DeckExtractor.shapes(xml)
      .filter((shape) => DeckExtractor.placeholderType(shape) === 'body')
      .map((shape) => DeckExtractor.shapeText(shape))
      .filter(Boolean)
      .join('\n');
  }

  private static shapes(xml: string): string[] {
    return xml.match(/<p:sp\b[\s\S]*?<\/p:sp>/g) ?? [];
  }

  private static placeholderType(shape: string): string | null {
    const placeholder = shape.match(/<p:ph\b[^>]*>/)?.[0];
    if (!placeholder) return null;
    return placeholder.match(/\btype="([^"]+)"/)?.[1] ?? 'body';
  }

  private static shapeText(shape: string): string {
    const paragraphs = shape.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? [];
    return DeckExtractor.lines(
      paragraphs
        .map((paragraph) => [...paragraph.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map((m) => DeckExtractor.decode(m[1])).join(''))
        .join('\n'),
    ).join('\n');
  }

  private static lines(text: string): string[] {
    return text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  private static decode(text: string): string {
    return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (entity, code: string) => {
      if (code[0] !== '#') return XML_ENTITIES[code] ?? entity;
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
    });
  }
}
