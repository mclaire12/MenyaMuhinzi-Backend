import { buildDocx, buildPdf } from '../../../../test/fixtures/documents';
import { ExtractionFailure, extractInSandbox } from './extraction-sandbox';

const limits = { timeoutMs: 20_000, maxPages: 50, maxMemoryMb: 256 };

describe('extractInSandbox', () => {
  jest.setTimeout(30_000);

  it('extracts PDF text page by page', async () => {
    const pdf = buildPdf([
      ['Irrigation', 'Water tomatoes in the morning.'],
      ['Harvesting', 'Pick ripe fruit.'],
    ]);
    const result = await extractInSandbox('pdf', pdf, limits);
    expect(result.pageCount).toBe(2);
    expect(result.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(result.pages[0].text).toContain('Water tomatoes in the morning.');
    expect(result.pages[1].text).toContain('Pick ripe fruit.');
  });

  it('extracts DOCX paragraphs and marks headings', async () => {
    const docx = await buildDocx(['# Nursery', 'Sow seeds 1 cm deep & cover.', 'Keep moist.']);
    const result = await extractInSandbox('docx', docx, limits);
    expect(result.pages).toEqual([
      { pageNumber: null, text: '# Nursery\n\nSow seeds 1 cm deep & cover.\n\nKeep moist.' },
    ]);
  });

  it('reports malformed PDFs as permanent failures', async () => {
    const broken = Buffer.from('%PDF-1.7\nthis is not a real pdf');
    await expect(extractInSandbox('pdf', broken, limits)).rejects.toMatchObject({
      constructor: ExtractionFailure,
      retryable: false,
    });
  });

  it('reports malformed DOCX files as permanent failures', async () => {
    const broken = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('not a zip archive'),
    ]);
    await expect(extractInSandbox('docx', broken, limits)).rejects.toMatchObject({
      retryable: false,
    });
  });

  it('refuses documents with more pages than allowed', async () => {
    const pdf = buildPdf([['One'], ['Two'], ['Three']]);
    await expect(extractInSandbox('pdf', pdf, { ...limits, maxPages: 2 })).rejects.toMatchObject({
      retryable: false,
    });
  });
});
