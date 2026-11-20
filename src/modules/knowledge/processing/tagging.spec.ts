import { Language } from '../../../generated/prisma/client';
import { chunkTags, topicDefinition } from './chunk-tags';
import { detectLanguage } from './language-detector';
import { cropTerms, detectTags, singular } from './tagging';

const crops = [
  { code: 'TOMATO', nameEn: 'Tomatoes', nameRw: 'Inyanya' },
  { code: 'CABBAGE', nameEn: 'Cabbages', nameRw: 'Amashu' },
  { code: 'CARROT', nameEn: 'Carrots', nameRw: 'Karoti' },
].map((crop) => ({ code: crop.code, terms: cropTerms(crop) }));

const topics = [
  topicDefinition({
    code: 'IRRIGATION',
    nameEn: 'Irrigation',
    nameRw: null,
    keywords: ['watering', 'drip'],
  }),
  topicDefinition({
    code: 'HARVESTING',
    nameEn: 'Harvesting',
    nameRw: null,
    keywords: ['harvest', 'ripe'],
  }),
];

describe('detectTags', () => {
  it('finds crops by English, Kinyarwanda and singular names, most frequent first', () => {
    expect(detectTags('Plant one tomato and many inyanya. Amashu need space.', crops)).toEqual([
      'TOMATO',
      'CABBAGE',
    ]);
  });

  it('matches whole words only', () => {
    expect(detectTags('The carrotcake recipe', crops)).toEqual([]);
  });

  it('finds topics from names and keywords', () => {
    expect(detectTags('Use drip watering before the harvest.', topics)).toEqual([
      'IRRIGATION',
      'HARVESTING',
    ]);
  });

  it('singularizes simple plurals', () => {
    expect(singular('Tomatoes')).toBe('Tomato');
    expect(singular('Cabbages')).toBe('Cabbage');
    expect(singular('gas')).toBe('gas');
  });
});

describe('chunkTags', () => {
  const context = { detectedCropCodes: ['CARROT'], topicDefinitions: topics };

  it('uses source crops, falling back to detected crops', () => {
    expect(
      chunkTags('text', { ...context, sourceCropCodes: ['TOMATO'], sourceTopicCodes: [] })
        .cropCodes,
    ).toEqual(['TOMATO']);
    expect(
      chunkTags('text', { ...context, sourceCropCodes: [], sourceTopicCodes: [] }).cropCodes,
    ).toEqual(['CARROT']);
  });

  it('limits detected topics to the source topics, falling back to all of them', () => {
    const text = 'Drip watering and harvest timing.';
    expect(
      chunkTags(text, { ...context, sourceCropCodes: [], sourceTopicCodes: ['HARVESTING'] })
        .topicCodes,
    ).toEqual(['HARVESTING']);
    expect(
      chunkTags('Unrelated text.', {
        ...context,
        sourceCropCodes: [],
        sourceTopicCodes: ['IRRIGATION'],
      }).topicCodes,
    ).toEqual(['IRRIGATION']);
    expect(
      chunkTags(text, { ...context, sourceCropCodes: [], sourceTopicCodes: [] }).topicCodes,
    ).toEqual(['IRRIGATION', 'HARVESTING']);
  });
});

describe('detectLanguage', () => {
  it('recognizes English and Kinyarwanda', () => {
    expect(
      detectLanguage(
        'Water the tomatoes in the morning and check the soil for moisture before you plant.',
      ).language,
    ).toBe(Language.en);
    expect(
      detectLanguage(
        'Inyanya zikunda izuba kandi ni ngombwa kuzuhira mu gitondo kugira ngo zikure neza cyane.',
      ).language,
    ).toBe(Language.rw);
  });

  it('does not guess from too little or mixed text', () => {
    expect(detectLanguage('Inyanya')).toEqual({ language: null, confidence: 0 });
    expect(detectLanguage('the na and ni of mu to ku in kandi').language).toBeNull();
  });
});
