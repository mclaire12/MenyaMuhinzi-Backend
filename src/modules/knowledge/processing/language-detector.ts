import { Language } from '../../../generated/prisma/client';

/** Frequent function words. Detection only reports a language when one clearly dominates. */
const KINYARWANDA_WORDS = new Set([
  'na',
  'ni',
  'mu',
  'ku',
  'kandi',
  'cyangwa',
  'iyo',
  'ubwo',
  'kugira',
  'ngo',
  'ari',
  'aho',
  'buri',
  'cyane',
  'neza',
  'ibi',
  'iki',
  'uyu',
  'izo',
  'abo',
  'uko',
  'kuko',
  'nka',
  'ndetse',
  'hamwe',
  'nyuma',
  'mbere',
  'kuri',
  'muri',
  'kwa',
  'ya',
  'yo',
  'bya',
  'byo',
  'rya',
  'ryo',
  'cya',
  'cyo',
  'wa',
  'wo',
  'za',
  'zo',
  'ba',
  'bo',
  'ntabwo',
  'nta',
  'bitewe',
  'kubera',
]);

const ENGLISH_WORDS = new Set([
  'the',
  'and',
  'of',
  'to',
  'in',
  'is',
  'are',
  'for',
  'with',
  'that',
  'on',
  'be',
  'this',
  'it',
  'as',
  'by',
  'or',
  'from',
  'at',
  'an',
  'should',
  'can',
  'will',
  'your',
  'you',
  'when',
  'into',
  'after',
  'before',
  'not',
  'each',
  'which',
  'they',
  'their',
  'have',
  'has',
  'was',
  'were',
  'than',
  'then',
]);

export interface LanguageGuess {
  language: Language | null;
  confidence: number;
}

export function detectLanguage(text: string): LanguageGuess {
  const tokens =
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .match(/[a-z]+/g) ?? [];
  let rw = 0;
  let en = 0;
  for (const token of tokens) {
    if (KINYARWANDA_WORDS.has(token)) rw += 1;
    if (ENGLISH_WORDS.has(token)) en += 1;
  }
  const hits = rw + en;
  if (hits < 5) return { language: null, confidence: 0 };
  const confidence = Math.max(rw, en) / hits;
  if (confidence < 0.65) return { language: null, confidence: Math.round(confidence * 100) / 100 };
  return {
    language: rw > en ? Language.rw : Language.en,
    confidence: Math.round(confidence * 100) / 100,
  };
}
