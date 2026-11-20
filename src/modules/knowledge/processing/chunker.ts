import { createHash } from 'node:crypto';
import type { NormalizedBlock } from './text-normalizer';

export interface ChunkingOptions {
  /** Target maximum characters per chunk. */
  chunkSize: number;
  /** Characters repeated from the end of the previous chunk in the same section. */
  chunkOverlap: number;
}

export interface DraftChunk {
  text: string;
  sectionTitle: string | null;
  headingPath: string[];
  pageNumber: number | null;
  pageEnd: number | null;
  overlapChars: number;
  contentHash: string;
}

export const CHUNK_SIZE_LIMITS = { min: 200, max: 8000 } as const;

export function assertChunkingOptions(options: ChunkingOptions): void {
  const { chunkSize, chunkOverlap } = options;
  if (
    !Number.isInteger(chunkSize) ||
    chunkSize < CHUNK_SIZE_LIMITS.min ||
    chunkSize > CHUNK_SIZE_LIMITS.max
  ) {
    throw new Error(
      `Chunk size must be a whole number from ${CHUNK_SIZE_LIMITS.min} to ${CHUNK_SIZE_LIMITS.max}`,
    );
  }
  if (
    !Number.isInteger(chunkOverlap) ||
    chunkOverlap < 0 ||
    chunkOverlap > Math.floor(chunkSize / 2)
  ) {
    throw new Error('Chunk overlap must be a whole number from 0 to half the chunk size');
  }
}

export function contentHash(text: string): string {
  return createHash('sha256').update(text.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex');
}

/** Splits a long paragraph at sentence ends, then at spaces, never exceeding `max`. */
export function splitLongText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const sentences = text.split(/(?<=[.!?])\s+/);
  const units: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= max) {
      units.push(sentence);
      continue;
    }
    let line = '';
    for (const word of sentence.split(/\s+/)) {
      const pieces =
        word.length > max ? (word.match(new RegExp(`.{1,${max}}`, 'g')) ?? []) : [word];
      for (const piece of pieces) {
        if (line && line.length + 1 + piece.length > max) {
          units.push(line);
          line = piece;
        } else {
          line = line ? `${line} ${piece}` : piece;
        }
      }
    }
    if (line) units.push(line);
  }
  const packed: string[] = [];
  let current = '';
  for (const unit of units) {
    if (current && current.length + 1 + unit.length > max) {
      packed.push(current);
      current = unit;
    } else {
      current = current ? `${current} ${unit}` : unit;
    }
  }
  if (current) packed.push(current);
  return packed;
}

/** The last `size` characters, moved forward to a sentence or word start so no word is cut. */
export function overlapTail(text: string, size: number): string {
  if (size <= 0 || text.length === 0) return '';
  if (text.length <= size) return '';
  const slice = text.slice(text.length - size);
  const sentence = slice.search(/(?<=[.!?])\s+\S/);
  if (sentence >= 0) return slice.slice(sentence).trim();
  const space = slice.indexOf(' ');
  return space >= 0 ? slice.slice(space + 1).trim() : '';
}

/**
 * Groups paragraphs into chunks that stay inside one section. A heading always
 * starts a new chunk. Chunks split for size repeat the end of the previous chunk.
 * Empty chunks and repeated chunk text are dropped.
 */
export function chunkBlocks(blocks: NormalizedBlock[], options: ChunkingOptions): DraftChunk[] {
  assertChunkingOptions(options);
  const { chunkSize, chunkOverlap } = options;
  const pieceLimit = chunkSize - chunkOverlap - 2;
  const chunks: DraftChunk[] = [];
  const seen = new Set<string>();
  let headings: string[] = [];

  let parts: string[] = [];
  let carry = '';
  let hasNewContent = false;
  let firstPage: number | null = null;
  let lastPage: number | null = null;

  const currentText = () => [carry, ...parts].filter(Boolean).join('\n\n');

  const emit = () => {
    const text = currentText().trim();
    if (hasNewContent && text) {
      const hash = contentHash(text);
      if (!seen.has(hash)) {
        seen.add(hash);
        chunks.push({
          text,
          sectionTitle: headings[headings.length - 1] ?? null,
          headingPath: [...headings],
          pageNumber: firstPage,
          pageEnd: lastPage,
          overlapChars: carry.length,
          contentHash: hash,
        });
      }
    }
  };

  const reset = (nextCarry: string) => {
    parts = [];
    carry = nextCarry;
    hasNewContent = false;
    firstPage = null;
    lastPage = null;
  };

  for (const block of blocks) {
    if (block.kind === 'heading') {
      emit();
      reset('');
      const level = Math.max(1, block.level ?? 1);
      headings = [...headings.slice(0, level - 1), block.text];
      continue;
    }
    for (const piece of splitLongText(block.text, pieceLimit)) {
      const candidate = currentText();
      if (hasNewContent && candidate.length + 2 + piece.length > chunkSize) {
        emit();
        reset(overlapTail(candidate, chunkOverlap));
      }
      parts.push(piece);
      hasNewContent = true;
      firstPage ??= block.pageNumber;
      lastPage = block.pageNumber ?? lastPage;
    }
  }
  emit();
  return chunks;
}
