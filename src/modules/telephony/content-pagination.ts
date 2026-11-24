/** Splits plain text into USSD/IVR-friendly chunks without breaking words when possible. */
export function paginatePlainText(text: string, maxChars: number): { pages: string[]; total: number } {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return { pages: [''], total: 1 };
  if (normalized.length <= maxChars) return { pages: [normalized], total: 1 };

  const pages: string[] = [];
  let rest = normalized;
  while (rest.length > 0) {
    if (rest.length <= maxChars) {
      pages.push(rest);
      break;
    }
    let cut = rest.lastIndexOf(' ', maxChars);
    if (cut < maxChars * 0.4) cut = maxChars;
    pages.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return { pages, total: pages.length };
}