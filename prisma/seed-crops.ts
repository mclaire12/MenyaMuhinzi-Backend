import type { PrismaClient } from '../src/generated/prisma/client';

export const INITIAL_CROPS = [
  {
    code: 'TOMATO',
    nameEn: 'Tomatoes',
    nameRw: 'Inyanya',
    description: 'Tomato production, from nursery management to harvest.',
  },
  {
    code: 'CABBAGE',
    nameEn: 'Cabbages',
    nameRw: 'Amashu',
    description: 'Cabbage production, including spacing, pests and harvest.',
  },
  {
    code: 'CARROT',
    nameEn: 'Carrots',
    nameRw: 'Karoti',
    description: 'Carrot production, from soil preparation to harvest.',
  },
] as const;

/** Idempotently creates the initial crops. An administrator's status change is kept. */
export async function seedCrops(prisma: PrismaClient): Promise<void> {
  for (const crop of INITIAL_CROPS) {
    await prisma.crop.upsert({
      where: { code: crop.code },
      update: { nameEn: crop.nameEn, nameRw: crop.nameRw, description: crop.description },
      create: crop,
    });
  }
}
