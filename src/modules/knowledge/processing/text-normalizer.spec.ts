import { looksLikeHeading, normalizeDocument } from './text-normalizer';

describe('normalizeDocument', () => {
  it('keeps headings and paragraphs with their page numbers', () => {
    const result = normalizeDocument([
      { pageNumber: 1, text: 'Irrigation\nWater tomatoes in the morning.\nUse drip lines.' },
      { pageNumber: 2, text: 'Harvesting\nPick ripe fruit.' },
    ]);
    expect(result.blocks).toEqual([
      { kind: 'heading', text: 'Irrigation', level: 1, pageNumber: 1 },
      { kind: 'paragraph', text: 'Water tomatoes in the morning. Use drip lines.', pageNumber: 1 },
      { kind: 'heading', text: 'Harvesting', level: 1, pageNumber: 2 },
      { kind: 'paragraph', text: 'Pick ripe fruit.', pageNumber: 2 },
    ]);
    expect(result.text).toBe(
      '# Irrigation\n\nWater tomatoes in the morning. Use drip lines.\n\n# Harvesting\n\nPick ripe fruit.',
    );
  });

  it('removes extra whitespace, control and invisible characters', () => {
    const result = normalizeDocument([
      {
        pageNumber: null,
        text: 'Soil\u00a0\u00a0 is   ready\u200b.\u0007\r\n\r\n\tCompost\thelps.',
      },
    ]);
    expect(result.blocks.map((block) => block.text)).toEqual(['Soil is ready.', 'Compost helps.']);
    expect(result.wordCount).toBe(5);
  });

  it('rejoins words hyphenated across lines and drops page-number lines', () => {
    const result = normalizeDocument([
      { pageNumber: 3, text: 'Apply fertil-\nizer before planting.\nPage 3 of 10' },
    ]);
    expect(result.blocks).toEqual([
      { kind: 'paragraph', text: 'Apply fertilizer before planting.', pageNumber: 3 },
    ]);
  });

  it('reads markdown headings with their depth', () => {
    const result = normalizeDocument([
      { pageNumber: null, text: '# Nursery\n\n## Seedbed\n\nKeep the seedbed moist.' },
    ]);
    expect(result.blocks.slice(0, 2)).toEqual([
      { kind: 'heading', text: 'Nursery', level: 1, pageNumber: null },
      { kind: 'heading', text: 'Seedbed', level: 2, pageNumber: null },
    ]);
  });

  it('treats a trailing title-like line as text', () => {
    const result = normalizeDocument([{ pageNumber: null, text: 'Thank You' }]);
    expect(result.blocks).toEqual([{ kind: 'paragraph', text: 'Thank You', pageNumber: null }]);
  });

  it('returns no blocks for whitespace-only input', () => {
    expect(normalizeDocument([{ pageNumber: 1, text: ' \n\n\t ' }]).blocks).toEqual([]);
  });
});

describe('looksLikeHeading', () => {
  it('accepts short title lines and rejects sentences', () => {
    expect(looksLikeHeading('2.1 Pest management')).toBe(true);
    expect(looksLikeHeading('Water every morning.')).toBe(false);
    expect(looksLikeHeading('lowercase start')).toBe(false);
  });
});
