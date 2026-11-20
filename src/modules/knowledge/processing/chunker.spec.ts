import {
  assertChunkingOptions,
  chunkBlocks,
  contentHash,
  overlapTail,
  splitLongText,
} from './chunker';
import type { NormalizedBlock } from './text-normalizer';

const sentence = (index: number) =>
  `Sentence number ${index} explains how farmers water tomato seedlings.`;
const paragraph = (from: number, count: number) =>
  Array.from({ length: count }, (_, offset) => sentence(from + offset)).join(' ');

describe('chunkBlocks', () => {
  it('starts a new chunk at each heading and records the section and page', () => {
    const blocks: NormalizedBlock[] = [
      { kind: 'heading', text: 'Irrigation', level: 1, pageNumber: 1 },
      { kind: 'paragraph', text: 'Water early.', pageNumber: 1 },
      { kind: 'heading', text: 'Harvesting', level: 1, pageNumber: 2 },
      { kind: 'paragraph', text: 'Pick ripe fruit.', pageNumber: 2 },
    ];
    const chunks = chunkBlocks(blocks, { chunkSize: 200, chunkOverlap: 0 });
    expect(chunks.map((chunk) => [chunk.text, chunk.sectionTitle, chunk.pageNumber])).toEqual([
      ['Water early.', 'Irrigation', 1],
      ['Pick ripe fruit.', 'Harvesting', 2],
    ]);
  });

  it('keeps the heading path for nested sections', () => {
    const chunks = chunkBlocks(
      [
        { kind: 'heading', text: 'Tomatoes', level: 1, pageNumber: null },
        { kind: 'heading', text: 'Nursery', level: 2, pageNumber: null },
        { kind: 'paragraph', text: 'Sow seeds 1 cm deep.', pageNumber: null },
      ],
      { chunkSize: 200, chunkOverlap: 0 },
    );
    expect(chunks[0]).toMatchObject({
      sectionTitle: 'Nursery',
      headingPath: ['Tomatoes', 'Nursery'],
      pageNumber: null,
    });
  });

  it('never exceeds the chunk size and repeats the configured overlap', () => {
    const blocks: NormalizedBlock[] = [
      { kind: 'paragraph', text: paragraph(1, 6), pageNumber: 1 },
      { kind: 'paragraph', text: paragraph(7, 6), pageNumber: 2 },
    ];
    const chunks = chunkBlocks(blocks, { chunkSize: 300, chunkOverlap: 80 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(300);
    for (let index = 1; index < chunks.length; index += 1) {
      const { overlapChars, text } = chunks[index];
      expect(overlapChars).toBeGreaterThan(0);
      expect(overlapChars).toBeLessThanOrEqual(80);
      expect(chunks[index - 1].text.endsWith(text.slice(0, overlapChars))).toBe(true);
    }
    expect(chunks[0].overlapChars).toBe(0);
    expect(chunks[chunks.length - 1].pageEnd).toBe(2);
  });

  it('does not overlap across sections', () => {
    const chunks = chunkBlocks(
      [
        { kind: 'paragraph', text: paragraph(1, 8), pageNumber: 1 },
        { kind: 'heading', text: 'Storage', level: 1, pageNumber: 2 },
        { kind: 'paragraph', text: 'Keep cabbages cool.', pageNumber: 2 },
      ],
      { chunkSize: 300, chunkOverlap: 80 },
    );
    const last = chunks[chunks.length - 1];
    expect(last).toMatchObject({
      text: 'Keep cabbages cool.',
      sectionTitle: 'Storage',
      overlapChars: 0,
    });
  });

  it('drops empty and duplicate chunks', () => {
    const chunks = chunkBlocks(
      [
        { kind: 'heading', text: 'Empty section', level: 1, pageNumber: 1 },
        { kind: 'heading', text: 'Weeds', level: 1, pageNumber: 1 },
        { kind: 'paragraph', text: 'Remove weeds weekly.', pageNumber: 1 },
        { kind: 'heading', text: 'Weeds again', level: 1, pageNumber: 2 },
        { kind: 'paragraph', text: 'Remove  weeds WEEKLY.', pageNumber: 2 },
      ],
      { chunkSize: 200, chunkOverlap: 0 },
    );
    expect(chunks).toHaveLength(1);
    expect(chunks.every((chunk) => chunk.text.trim().length > 0)).toBe(true);
  });

  it('validates the options', () => {
    expect(() => assertChunkingOptions({ chunkSize: 100, chunkOverlap: 0 })).toThrow('Chunk size');
    expect(() => assertChunkingOptions({ chunkSize: 400, chunkOverlap: 201 })).toThrow('overlap');
    expect(() => assertChunkingOptions({ chunkSize: 400, chunkOverlap: 200 })).not.toThrow();
  });
});

describe('chunk helpers', () => {
  it('splits long text at sentences, then words', () => {
    const pieces = splitLongText(paragraph(1, 5), 120);
    expect(pieces.every((piece) => piece.length <= 120)).toBe(true);
    expect(pieces.join(' ')).toBe(paragraph(1, 5));
    expect(splitLongText('x'.repeat(250), 100).map((piece) => piece.length)).toEqual([
      100, 100, 50,
    ]);
  });

  it('cuts the overlap at a sentence or word boundary', () => {
    expect(overlapTail('First sentence here. Second one.', 20)).toBe('Second one.');
    expect(overlapTail('alpha beta gamma delta', 12)).toBe('gamma delta');
    expect(overlapTail('short', 20)).toBe('');
  });

  it('hashes text ignoring case and spacing', () => {
    expect(contentHash('Remove  weeds\nweekly')).toBe(contentHash('remove weeds weekly'));
  });
});
