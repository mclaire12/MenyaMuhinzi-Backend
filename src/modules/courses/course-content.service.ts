import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CoursesService } from './courses.service';
import type {
  CreateLessonDto,
  CreateModuleDto,
  LessonResponseDto,
  ModuleResponseDto,
  UpdateLessonDto,
  UpdateModuleDto,
} from './dto/course-content.dto';
import type { CreateLessonResourceDto, LessonResourceResponseDto, UpdateLessonResourceDto } from './dto/lesson-resource.dto';

const lessonCatalogueSelect = {
  id: true,
  moduleId: true,
  title: true,
  description: true,
  lessonType: true,
  contentRef: true,
  learningObjectives: true,
  language: true,
  estimatedDurationMinutes: true,
  displayOrder: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class CourseContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly courses: CoursesService,
  ) {}

  async createModule(courseId: string, dto: CreateModuleDto): Promise<ModuleResponseDto> {
    await this.courses.assertMutable(courseId);
    const displayOrder = dto.displayOrder ?? (await this.nextOrder('module', courseId));
    return this.prisma.courseModule.create({
      data: {
        courseId,
        title: dto.title,
        description: dto.description,
        learningObjectives: dto.learningObjectives ?? [],
        displayOrder,
        status: dto.status,
      },
    });
  }

  async listModules(courseId: string, actor: AuthenticatedUser): Promise<ModuleResponseDto[]> {
    await this.courses.assertReadable(courseId, actor);
    return this.prisma.courseModule.findMany({ where: { courseId }, orderBy: { displayOrder: 'asc' } });
  }

  async updateModule(id: string, dto: UpdateModuleDto): Promise<ModuleResponseDto> {
    const module = await this.findModule(id);
    await this.courses.assertMutable(module.courseId);
    return this.prisma.courseModule.update({ where: { id }, data: dto });
  }

  async removeModule(id: string): Promise<void> {
    const module = await this.findModule(id);
    await this.courses.assertMutable(module.courseId);
    await this.prisma.courseModule.delete({ where: { id } });
  }

  async createLesson(moduleId: string, dto: CreateLessonDto): Promise<LessonResponseDto> {
    const module = await this.findModule(moduleId);
    await this.courses.assertMutable(module.courseId);
    const displayOrder = dto.displayOrder ?? (await this.nextOrder('lesson', moduleId));
    return this.prisma.lesson.create({
      data: {
        moduleId,
        title: dto.title,
        description: dto.description,
        lessonType: dto.lessonType,
        contentRef: dto.contentRef,
        mainContent: dto.mainContent,
        learningObjectives: dto.learningObjectives ?? [],
        language: dto.language,
        estimatedDurationMinutes: dto.estimatedDurationMinutes,
        displayOrder,
        status: dto.status,
      },
    });
  }

  async listLessons(moduleId: string, actor: AuthenticatedUser): Promise<LessonResponseDto[]> {
    const module = await this.findModule(moduleId);
    await this.courses.assertReadable(module.courseId, actor);
    return this.prisma.lesson.findMany({
      where: { moduleId },
      select: lessonCatalogueSelect,
      orderBy: { displayOrder: 'asc' },
    });
  }

  async updateLesson(id: string, dto: UpdateLessonDto): Promise<LessonResponseDto> {
    const lesson = await this.findLesson(id);
    const module = await this.findModule(lesson.moduleId);
    await this.courses.assertMutable(module.courseId);
    return this.prisma.lesson.update({ where: { id }, data: dto });
  }

  async removeLesson(id: string): Promise<void> {
    const lesson = await this.findLesson(id);
    const module = await this.findModule(lesson.moduleId);
    await this.courses.assertMutable(module.courseId);
    await this.prisma.lesson.delete({ where: { id } });
  }

  async addResource(lessonId: string, dto: CreateLessonResourceDto, actor: AuthenticatedUser): Promise<LessonResourceResponseDto> {
    const lesson = await this.findLesson(lessonId);
    const module = await this.findModule(lesson.moduleId);
    await this.courses.assertMutable(module.courseId);
    const displayOrder = dto.displayOrder ?? (await this.nextResourceOrder(lessonId));
    return this.prisma.lessonResource.create({
      data: {
        lessonId,
        resourceType: dto.resourceType,
        contentRef: dto.contentRef,
        title: dto.title,
        description: dto.description,
        language: dto.language,
        displayOrder,
        fileSizeBytes: dto.fileSizeBytes,
        mimeType: dto.mimeType,
        createdById: actor.id,
      },
    });
  }

  async listResources(lessonId: string): Promise<LessonResourceResponseDto[]> {
    await this.findLesson(lessonId);
    return this.prisma.lessonResource.findMany({ where: { lessonId }, orderBy: { displayOrder: 'asc' } });
  }

  async updateResource(id: string, dto: UpdateLessonResourceDto): Promise<LessonResourceResponseDto> {
    const resource = await this.prisma.lessonResource.findUnique({
      where: { id },
      select: { id: true, lesson: { select: { moduleId: true } } },
    });
    if (!resource) throw new NotFoundException('Lesson resource not found');
    const module = await this.findModule(resource.lesson.moduleId);
    await this.courses.assertMutable(module.courseId);
    return this.prisma.lessonResource.update({ where: { id }, data: dto });
  }

  async removeResource(id: string): Promise<void> {
    const resource = await this.prisma.lessonResource.findUnique({
      where: { id },
      select: { id: true, lesson: { select: { moduleId: true } } },
    });
    if (!resource) throw new NotFoundException('Lesson resource not found');
    const module = await this.findModule(resource.lesson.moduleId);
    await this.courses.assertMutable(module.courseId);
    await this.prisma.lessonResource.delete({ where: { id } });
  }

  private async nextResourceOrder(lessonId: string): Promise<number> {
    const max = await this.prisma.lessonResource.aggregate({ where: { lessonId }, _max: { displayOrder: true } });
    return (max._max.displayOrder ?? -1) + 1;
  }

  private async findModule(id: string): Promise<{ id: string; courseId: string }> {
    const module = await this.prisma.courseModule.findUnique({ where: { id }, select: { id: true, courseId: true } });
    if (!module) throw new NotFoundException('Module not found');
    return module;
  }

  private async findLesson(id: string): Promise<{ id: string; moduleId: string }> {
    const lesson = await this.prisma.lesson.findUnique({ where: { id }, select: { id: true, moduleId: true } });
    if (!lesson) throw new NotFoundException('Lesson not found');
    return lesson;
  }

  private async nextOrder(kind: 'module' | 'lesson', parentId: string): Promise<number> {
    const max =
      kind === 'module'
        ? (await this.prisma.courseModule.aggregate({ where: { courseId: parentId }, _max: { displayOrder: true } }))._max
            .displayOrder
        : (await this.prisma.lesson.aggregate({ where: { moduleId: parentId }, _max: { displayOrder: true } }))._max
            .displayOrder;
    return (max ?? -1) + 1;
  }
}
