import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RecordStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { CreateCropDto, CropResponseDto, UpdateCropDto } from './dto/crop.dto';

@Injectable()
export class CropsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(status?: RecordStatus): Promise<CropResponseDto[]> {
    return this.prisma.crop.findMany({
      where: status ? { status } : undefined,
      orderBy: { nameEn: 'asc' },
    });
  }

  async findOne(id: string): Promise<CropResponseDto> {
    const crop = await this.prisma.crop.findUnique({ where: { id } });
    if (!crop) throw new NotFoundException('Crop not found');
    return crop;
  }

  async create(dto: CreateCropDto): Promise<CropResponseDto> {
    try {
      return await this.prisma.crop.create({ data: dto });
    } catch (error) {
      throw this.mapUnique(error);
    }
  }

  async update(id: string, dto: UpdateCropDto): Promise<CropResponseDto> {
    await this.findOne(id);
    try {
      return await this.prisma.crop.update({ where: { id }, data: dto });
    } catch (error) {
      throw this.mapUnique(error);
    }
  }

  /** Deactivates the crop. Existing courses and groups keep their reference. */
  async deactivate(id: string): Promise<CropResponseDto> {
    await this.findOne(id);
    return this.prisma.crop.update({ where: { id }, data: { status: RecordStatus.INACTIVE } });
  }

  private mapUnique(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException('A crop with this code or name already exists');
    }
    return error;
  }
}
