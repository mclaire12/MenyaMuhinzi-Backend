import { BadRequestException } from '@nestjs/common';
import { RecordStatus, type Prisma } from '../../generated/prisma/client';
import type { PrismaService } from '../../infrastructure/database/prisma.service';

export const cropSummarySelect = {
  id: true,
  code: true,
  nameEn: true,
  nameRw: true,
} satisfies Prisma.CropSelect;

/** Rejects missing and deactivated crops. */
export async function assertActiveCrop(prisma: PrismaService, cropId: string): Promise<void> {
  const crop = await prisma.crop.findUnique({ where: { id: cropId }, select: { status: true } });
  if (!crop || crop.status !== RecordStatus.ACTIVE) {
    throw new BadRequestException('Crop is not available');
  }
}
