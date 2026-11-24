import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RecordStatus } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { RoleCode } from '../../roles/rbac.constants';

/** Resolves which farmer user ids a facilitator may see in reports. */
@Injectable()
export class ReportScopeService {
  constructor(private readonly prisma: PrismaService) {}

  isAdmin(actor: AuthenticatedUser): boolean {
    return actor.roles.includes(RoleCode.Admin);
  }

  /**
   * Farmer user ids in the facilitator's groups (optionally one group).
   * Administrators must not call this for platform-wide reports.
   */
  async facilitatorFarmerIds(actor: AuthenticatedUser, groupId?: string): Promise<string[]> {
    if (this.isAdmin(actor)) {
      throw new ForbiddenException('Use administrative report endpoints for platform-wide data');
    }
    if (groupId) {
      const group = await this.prisma.facilitatorGroup.findFirst({
        where: { id: groupId, facilitatorId: actor.id, status: RecordStatus.ACTIVE },
        select: { id: true },
      });
      if (!group) throw new NotFoundException('Facilitator group not found');
      const members = await this.prisma.facilitatorGroupMember.findMany({
        where: { groupId },
        select: { userId: true },
      });
      return members.map((member) => member.userId);
    }
    const members = await this.prisma.facilitatorGroupMember.findMany({
      where: { group: { facilitatorId: actor.id, status: RecordStatus.ACTIVE } },
      select: { userId: true },
      distinct: ['userId'],
    });
    return members.map((member) => member.userId);
  }

  async assertOwnsGroup(actor: AuthenticatedUser, groupId: string): Promise<void> {
    if (this.isAdmin(actor)) return;
    const group = await this.prisma.facilitatorGroup.findFirst({
      where: { id: groupId, facilitatorId: actor.id },
      select: { id: true },
    });
    if (!group) throw new NotFoundException('Facilitator group not found');
  }
}
