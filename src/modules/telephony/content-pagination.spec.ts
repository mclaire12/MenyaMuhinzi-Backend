import { paginatePlainText } from './content-pagination';

describe('paginatePlainText', () => {
  it('splits long lesson text into pages', () => {
    const text = 'Word '.repeat(80).trim();
    const { pages, total } = paginatePlainText(text, 40);
    expect(total).toBeGreaterThan(1);
    expect(pages.join(' ').replace(/\s+/g, ' ')).toContain('Word');
  });

  it('returns a single page for short content', () => {
    expect(paginatePlainText('Muraho', 160)).toEqual({ pages: ['Muraho'], total: 1 });
  });
});