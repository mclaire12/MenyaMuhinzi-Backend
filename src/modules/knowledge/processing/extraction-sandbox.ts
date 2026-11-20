import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

export interface ExtractedPage {
  /** Null when the format has no pages (DOCX, TXT). */
  pageNumber: number | null;
  text: string;
}

export interface ExtractionResult {
  pages: ExtractedPage[];
  pageCount: number | null;
  metadata: Record<string, string>;
  warnings: string[];
}

export interface SandboxLimits {
  timeoutMs: number;
  maxPages: number;
  maxMemoryMb: number;
}

export class ExtractionFailure extends Error {
  constructor(
    message: string,
    /** Malformed input will fail again, so the job should not be retried. */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/**
 * Runs inside a worker thread. Parsers only read the bytes they are given:
 * pdf.js runs with eval disabled and without fonts, and mammoth only converts
 * the document body to HTML. Nothing from the document is executed.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&#(\\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

async function extractPdf(bytes) {
  const pdfjs = await import(workerData.pdfjsUrl);
  pdfjs.GlobalWorkerOptions.workerSrc = workerData.pdfWorkerUrl;
  const task = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    stopAtErrors: true,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    if (doc.numPages > workerData.maxPages) {
      throw new Error('The PDF has ' + doc.numPages + ' pages; the limit is ' + workerData.maxPages);
    }
    const pages = [];
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        text += item.str;
        if (item.hasEOL) text += '\\n';
      }
      pages.push({ pageNumber: number, text });
      page.cleanup();
    }
    const metadata = {};
    try {
      const info = (await doc.getMetadata()).info || {};
      for (const key of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate']) {
        if (typeof info[key] === 'string' && info[key].trim()) metadata[key.toLowerCase()] = info[key].trim().slice(0, 500);
      }
    } catch (error) {}
    return { pages, pageCount: doc.numPages, metadata, warnings: [] };
  } finally {
    await task.destroy();
  }
}

async function extractDocx(bytes) {
  const mammoth = require(workerData.mammothPath);
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  const lines = [];
  const blockPattern = /<(h[1-6]|p|li)(?:\\s[^>]*)?>([\\s\\S]*?)<\\/\\1>/g;
  let match;
  while ((match = blockPattern.exec(result.value)) !== null) {
    const text = decodeEntities(match[2].replace(/<br\\s*\\/?>/g, '\\n').replace(/<[^>]+>/g, '')).trim();
    if (!text) continue;
    lines.push(match[1].startsWith('h') ? '#'.repeat(Number(match[1][1])) + ' ' + text : text);
  }
  const warnings = result.messages.filter((m) => m.type === 'error').map((m) => String(m.message).slice(0, 300));
  return { pages: [{ pageNumber: null, text: lines.join('\\n\\n') }], pageCount: null, metadata: {}, warnings };
}

(async () => {
  try {
    const bytes = new Uint8Array(workerData.bytes);
    const result = workerData.kind === 'pdf' ? await extractPdf(bytes) : await extractDocx(bytes);
    parentPort.postMessage({ ok: true, result });
  } catch (error) {
    parentPort.postMessage({ ok: false, message: String((error && error.message) || error).slice(0, 500) });
  }
})();
`;

function moduleUrls(): { pdfjsUrl: string; pdfWorkerUrl: string; mammothPath: string } {
  return {
    pdfjsUrl: pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href,
    pdfWorkerUrl: pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href,
    mammothPath: require.resolve('mammoth'),
  };
}

/** Parses a PDF or DOCX in an isolated worker thread with a memory cap and a timeout. */
export function extractInSandbox(
  kind: 'pdf' | 'docx',
  bytes: Buffer,
  limits: SandboxLimits,
): Promise<ExtractionResult> {
  return new Promise((resolve, reject) => {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { kind, bytes: copy.buffer, maxPages: limits.maxPages, ...moduleUrls() },
      transferList: [copy.buffer],
      resourceLimits: { maxOldGenerationSizeMb: limits.maxMemoryMb, maxYoungGenerationSizeMb: 64 },
      stdout: true,
      stderr: true,
    });
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      action();
    };
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(
            new ExtractionFailure(`Text extraction took longer than ${limits.timeoutMs} ms`, true),
          ),
        ),
      limits.timeoutMs,
    );
    worker.once(
      'message',
      (message: { ok: boolean; result?: ExtractionResult; message?: string }) => {
        if (message.ok && message.result) {
          const result = message.result;
          finish(() => resolve(result));
        } else {
          finish(() =>
            reject(
              new ExtractionFailure(
                `The document could not be read: ${message.message ?? 'unknown error'}`,
                false,
              ),
            ),
          );
        }
      },
    );
    worker.once('error', (error) => {
      const memory = /memory/i.test(error.message);
      finish(() =>
        reject(
          new ExtractionFailure(
            memory
              ? 'The document needs more memory than the extraction limit allows'
              : `Text extraction failed: ${error.message}`,
            !memory,
          ),
        ),
      );
    });
    worker.once('exit', (code) => {
      finish(() =>
        reject(
          new ExtractionFailure(`Text extraction stopped unexpectedly (exit code ${code})`, true),
        ),
      );
    });
  });
}
