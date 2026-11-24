import type { Language } from '../../../generated/prisma/client';

export type UssdMenuCode =
  | 'MAIN'
  | 'LANGUAGE'
  | 'LEARN'
  | 'MY_COURSES'
  | 'CONTINUE'
  | 'PROGRESS'
  | 'ASSESSMENT_LIST'
  | 'ASSESSMENT_QUESTION'
  | 'COURSE_LIST'
  | 'COURSE_CONFIRM'
  | 'MODULE_LIST'
  | 'LESSON_LIST'
  | 'LESSON_CONTENT'
  | 'HELP'
  | 'BLOCKED'
  | 'UNKNOWN'
  | 'DISABLED';

const MAIN: Record<Language, string[]> = {
  rw: [
    'MenyaMuhinzi',
    '1. Kwiga ubuhinzi',
    '2. Amasomo yanjye',
    '3. Komeza aho nari ngeze',
    '4. Aho ngeze mu myigire',
    '5. Guhindura ururimi',
    '6. Ubufasha',
    '7. Ibizamini',
    '0. Gusohoka',
  ],
  en: [
    'MenyaMuhinzi',
    '1. Learn agriculture',
    '2. My courses',
    '3. Continue learning',
    '4. My learning progress',
    '5. Change language',
    '6. Help',
    '7. Assessments',
    '0. Exit',
  ],
};

const LANGUAGE: Record<Language, string[]> = {
  rw: ['Hitamo ururimi:', '1. Kinyarwanda', '2. Icyongereza', '0. Gusubira inyuma'],
  en: ['Choose language:', '1. Kinyarwanda', '2. English', '0. Back'],
};

export const USSD_MENU_TEXT: Partial<Record<UssdMenuCode, Record<Language, string[]>>> = {
  MAIN,
  LANGUAGE,
};

export function menuLines(code: UssdMenuCode, language: Language, extra?: string[]): string[] {
  const base = USSD_MENU_TEXT[code]?.[language];
  if (base) return extra ? [...base, ...extra] : [...base];
  return extra ?? (language === 'rw' ? ['Hitamo igisubizo'] : ['Choose an option']);
}
