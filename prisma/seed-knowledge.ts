import type { PrismaClient } from '../src/generated/prisma/client';

/**
 * Initial agricultural topics. Kinyarwanda names are left empty for an administrator
 * to enter; they are not generated. Keywords help suggest topics during processing.
 */
export const INITIAL_TOPICS = [
  {
    code: 'LAND_PREPARATION',
    nameEn: 'Land preparation',
    keywords: [
      'land preparation',
      'ploughing',
      'plowing',
      'tillage',
      'digging',
      'soil preparation',
      'clearing',
    ],
  },
  {
    code: 'SEED_SELECTION',
    nameEn: 'Seed selection',
    keywords: ['seed selection', 'certified seed', 'variety', 'varieties', 'seed quality'],
  },
  {
    code: 'NURSERY_PREPARATION',
    nameEn: 'Nursery preparation',
    keywords: ['nursery', 'seedbed', 'seedlings', 'transplants', 'sowing'],
  },
  {
    code: 'PLANTING',
    nameEn: 'Planting',
    keywords: ['planting', 'transplanting', 'spacing', 'plant spacing', 'rows'],
  },
  {
    code: 'IRRIGATION',
    nameEn: 'Irrigation',
    keywords: ['irrigation', 'watering', 'drip', 'water', 'moisture'],
  },
  {
    code: 'FERTILIZATION',
    nameEn: 'Fertilization',
    keywords: ['fertilizer', 'fertiliser', 'manure', 'compost', 'npk', 'urea', 'nutrients'],
  },
  {
    code: 'WEED_MANAGEMENT',
    nameEn: 'Weed management',
    keywords: ['weed', 'weeds', 'weeding', 'mulch', 'mulching', 'herbicide'],
  },
  {
    code: 'PEST_MANAGEMENT',
    nameEn: 'Pest management',
    keywords: ['pest', 'pests', 'insects', 'aphids', 'caterpillars', 'whitefly', 'insecticide'],
  },
  {
    code: 'DISEASE_MANAGEMENT',
    nameEn: 'Disease management',
    keywords: ['disease', 'diseases', 'blight', 'wilt', 'fungal', 'fungicide', 'rot'],
  },
  {
    code: 'HARVESTING',
    nameEn: 'Harvesting',
    keywords: ['harvest', 'harvesting', 'picking', 'ripe', 'maturity'],
  },
  {
    code: 'STORAGE',
    nameEn: 'Storage',
    keywords: ['storage', 'post-harvest', 'postharvest', 'store', 'cooling', 'shelf life'],
  },
  {
    code: 'MARKETING',
    nameEn: 'Marketing',
    keywords: ['market', 'marketing', 'price', 'prices', 'buyers', 'selling', 'cooperative'],
  },
] as const;

/** Creates missing topics. Existing topics are left as administrators edited them. */
export async function seedKnowledgeTopics(prisma: PrismaClient): Promise<void> {
  for (const topic of INITIAL_TOPICS) {
    await prisma.knowledgeTopic.upsert({
      where: { code: topic.code },
      update: {},
      create: { code: topic.code, nameEn: topic.nameEn, keywords: [...topic.keywords] },
    });
  }
}
