export interface TagDefinition {
  code: string;
  terms: string[];
}

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "Tomatoes" also matches "tomato"; "Cabbages" also matches "cabbage". */
export function singular(word: string): string {
  if (/oes$/i.test(word)) return word.slice(0, -2);
  if (/s$/i.test(word) && word.length > 3) return word.slice(0, -1);
  return word;
}

export function cropTerms(crop: { code: string; nameEn: string; nameRw: string }): string[] {
  return [
    ...new Set([crop.nameEn, singular(crop.nameEn), crop.nameRw, crop.code.replace(/_/g, ' ')]),
  ];
}

/** Returns the codes whose terms appear as whole words, most frequent first. */
export function detectTags(text: string, definitions: TagDefinition[]): string[] {
  const folded = fold(text);
  const scored = definitions
    .map((definition) => {
      let count = 0;
      for (const term of definition.terms) {
        const cleaned = fold(term).trim();
        if (cleaned.length < 2) continue;
        const pattern = new RegExp(
          `(^|[^a-z0-9])${escapeRegExp(cleaned).replace(/\s+/g, '\\s+')}(?=$|[^a-z0-9])`,
          'g',
        );
        count += folded.match(pattern)?.length ?? 0;
      }
      return { code: definition.code, count };
    })
    .filter((entry) => entry.count > 0)
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
  return scored.map((entry) => entry.code);
}
