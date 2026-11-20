import { Injectable, NotFoundException } from '@nestjs/common';
import { paginated, paginationArgs, type Paginated } from '../../../common/dto/pagination.dto';
import { Prisma, type NotificationCategory } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type {
  AdminDeliveryResponseDto,
  AdminListDeliveriesQueryDto,
  ListNotificationsQueryDto,
  MarkAllReadDto,
  MarkAllReadResponseDto,
  NotificationDetailResponseDto,
  NotificationResponseDto,
  UnreadCountResponseDto,
} from '../dto/notification.dto';
import { ALL_CATEGORIES } from '../notifications.constants';
import { toDeliveryStatus, toNotification } from './notifications.mappers';

/** A user's own notification inbox. Every query is scoped to the caller, so other users' notifications are 404. */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: string,
    query: ListNotificationsQueryDto,
  ): Promise<Paginated<NotificationResponseDto>> {
    const where: Prisma.NotificationWhereInput = {
      userId,
      archivedAt: query.archived ? { not: null } : null,
      ...(query.category ? { category: query.category } : {}),
      ...(query.read === undefined ? {} : { readAt: query.read ? { not: null } : null }),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...paginationArgs(query),
      }),
    ]);
    return paginated(rows.map(toNotification), total, query);
  }

  async unreadCount(userId: string): Promise<UnreadCountResponseDto> {
    const groups = await this.prisma.notification.groupBy({
      by: ['category'],
      where: { userId, readAt: null, archivedAt: null },
      _count: { _all: true },
    });
    const counts = new Map<NotificationCategory, number>(
      groups.map((group) => [group.category, group._count._all]),
    );
    const byCategory = ALL_CATEGORIES.filter((category) => counts.has(category)).map(
      (category) => ({
        category,
        count: counts.get(category) as number,
      }),
    );
    return { total: byCategory.reduce((sum, item) => sum + item.count, 0), byCategory };
  }

  async findOne(userId: string, id: string): Promise<NotificationDetailResponseDto> {
    const row = await this.prisma.notification.findFirst({
      where: { id, userId },
      include: { deliveries: { orderBy: { channel: 'asc' } } },
    });
    if (!row) throw new NotFoundException('Notification not found');
    return { ...toNotification(row), deliveries: row.deliveries.map(toDeliveryStatus) };
  }

  /** Marking as read is idempotent: the original read time is kept. */
  async markRead(userId: string, id: string): Promise<NotificationDetailResponseDto> {
    await this.require(userId, id);
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return this.findOne(userId, id);
  }

  async markUnread(userId: string, id: string): Promise<NotificationDetailResponseDto> {
    await this.require(userId, id);
    await this.prisma.notification.updateMany({ where: { id, userId }, data: { readAt: null } });
    return this.findOne(userId, id);
  }

  async markAllRead(userId: string, dto: MarkAllReadDto): Promise<MarkAllReadResponseDto> {
    const { count } = await this.prisma.notification.updateMany({
      where: {
        userId,
        readAt: null,
        archivedAt: null,
        ...(dto.category ? { category: dto.category } : {}),
      },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }

  /** Archived notifications leave the inbox and the unread count; they are never deleted. */
  async archive(userId: string, id: string): Promise<NotificationDetailResponseDto> {
    await this.require(userId, id);
    await this.prisma.notification.updateMany({
      where: { id, userId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    return this.findOne(userId, id);
  }

  // ------------------------------------------------------------ administration

  /** Delivery oversight for administrators. Message text is not included. */
  async listDeliveries(
    query: AdminListDeliveriesQueryDto,
  ): Promise<Paginated<AdminDeliveryResponseDto>> {
    const where: Prisma.NotificationDeliveryWhereInput = {
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.isTestData === undefined ? {} : { isTestData: query.isTestData }),
      ...(query.notificationId ? { notificationId: query.notificationId } : {}),
      ...(query.userId ? { notification: { userId: query.userId } } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.notificationDelivery.count({ where }),
      this.prisma.notificationDelivery.findMany({
        where,
        include: { notification: { select: { userId: true, templateCode: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...paginationArgs(query),
      }),
    ]);
    return paginated(
      rows.map((row) => ({
        ...toDeliveryStatus(row),
        id: row.id,
        notificationId: row.notificationId,
        userId: row.notification.userId,
        attempts: row.attempts,
        providerId: row.providerId,
        templateCode: row.notification.templateCode,
        createdAt: row.createdAt,
      })),
      total,
      query,
    );
  }

  private async require(userId: string, id: string): Promise<void> {
    const exists = await this.prisma.notification.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Notification not found');
  }
}
