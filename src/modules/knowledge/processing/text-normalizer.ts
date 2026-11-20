import type { ExtractedPage } from './extraction-sandbox';

export interface NormalizedBlock {
  kind: 'heading' | 'paragraph';
  text: string;
  /** Heading depth, 1 for a top-level heading. */
  level?: number;
  pageNumber: number | null;
}

export interface NormalizedDocument {
  blocks: NormalizedBlock[];
  text: string;
  characterCount: number;
  wordCount: number;
}

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const INVISIBLE_CHARACTERS = /[\u00ad\u200b-\u200d\u2060\ufeff]/g;
const UNUSUAL_SPACES = /[\t\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;
const PAGE_NUMBER_LINE = /^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i;
const MARKDOWN_HEADING = /^(#{1,6})\s+(.+)$/;

function cleanLine(line: string): string {
  return line.replace(UNUSUAL_SPACES, ' ').replace(/ {2,}/g, ' ').trim();
}

/** A short title-like line: no sentence punctuation, few words, starts with a capital or a number. */
export function looksLikeHeading(line: string): boolean {
  if (line.length < 2 || line.length > 80) return false;
  if (/[.,;!?-]$/.test(line)) return false;
  if (line.split(/\s+/).length > 10) return false;
  return /^(\d+(\.\d+)*\.?\s+)?[A-Z\u00c0-\u024f]/.test(line);
}

function joinLines(paragraph: string, line: string): string {
  if (!paragraph) return line;
  if (/[A-Za-z\u00c0-\u024f]-$/.test(paragraph) && /^[a-z\u00df-\u024f]/.test(line)) {
    return paragraph.slice(0, -1) + line;
  }
  return `${paragraph} ${line}`;
}

/**
 * Cleans extracted text and splits it into headings and paragraphs.
 * Wrapped lines inside a paragraph are joined, words broken by a hyphen at a
 * line end are rejoined, and lone page-number lines are dropped.
 */
export function normalizeDocument(pages: ExtractedPage[]): NormalizedDocument {
  const blocks: NormalizedBlock[] = [];
  for (const page of pages) {
    const text = page.text
      .normalize('NFC')
      .replace(/\r\n?/g, '\n')
      .replace(CONTROL_CHARACTERS, '')
      .replace(INVISIBLE_CHARACTERS, '');
    const groups = text.split(/\n\s*\n/);
    for (const group of groups) {
      const lines = group
        .split('\n')
        .map(cleanLine)
        .filter((line) => line.length > 0 && !PAGE_NUMBER_LINE.test(line));
      let paragraph = '';
      const flush = () => {
        if (paragraph)
          blocks.push({ kind: 'paragraph', text: paragraph, pageNumber: page.pageNumber });
        paragraph = '';
      };
      lines.forEach((line, index) => {
        const markdown = MARKDOWN_HEADING.exec(line);
        if (markdown) {
          flush();
          blocks.push({
            kind: 'heading',
            text: markdown[2].trim(),
            level: markdown[1].length,
            pageNumber: page.pageNumber,
          });
          return;
        }
        const startsSection = paragraph === '' || /[.!?:]$/.test(paragraph);
        const isLastInGroup = index === lines.length - 1;
        const singleLineGroup = lines.length === 1;
        // A following line that starts in lower case continues the same sentence.
        const continued = /^[a-z\u00df-\u024f]/.test(lines[index + 1] ?? '');
        if (
          looksLikeHeading(line) &&
          startsSection &&
          !continued &&
          (!isLastInGroup || singleLineGroup)
        ) {
          flush();
          blocks.push({
            kind: 'heading',
            text: line.replace(/:$/, ''),
            level: 1,
            pageNumber: page.pageNumber,
          });
          return;
        }
        paragraph = joinLines(paragraph, line);
      });
      flush();
    }
  }

  // A heading at the very end, with nothing after it, is ordinary text.
  const last = blocks[blocks.length - 1];
  if (last?.kind === 'heading')
    blocks[blocks.length - 1] = { kind: 'paragraph', text: last.text, pageNumber: last.pageNumber };

  const text = blocks
    .map((block) =>
      block.kind === 'heading' ? `${'#'.repeat(block.level ?? 1)} ${block.text}` : block.text,
    )
    .join('\n\n');
  const plain = blocks.map((block) => block.text).join(' ');
  return {
    blocks,
    text,
    characterCount: plain.length,
    wordCount: plain.split(/\s+/).filter(Boolean).length,
  };
}
