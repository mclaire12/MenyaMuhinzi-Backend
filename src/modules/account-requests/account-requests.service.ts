import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { paginated, paginationArgs, type Paginated } from '../../common/dto/pagination.dto';
import {
  AccountRequestStatus,
  ApprovalDecision,
  Prisma,
  TokenRevocationReason,
  UserStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { revokeActiveWebSessions } from '../auth/services/web-session.revocation';
import { farmerRoleFor } from '../farmers/farmers.service';
import { NotificationEvent } from '../notifications/events/notification-events';
import { NotificationPublisher } from '../notifications/publishing/notification-publisher.service';
import { RoleCode } from '../roles/rbac.constants';
import { AccountEmailService } from '../users/account-email.service';
import { EmailVerificationService } from '../users/email-verification.service';
import { toUserDetailResponse, userDetailSelect } from '../users/user.mapper';
import { UserProvisioningService } from '../users/user-provisioning.service';
import { searchConditions } from '../users/users.service';
import type {
  AccountRequestResponseDto,
  ApproveAccountRequestDto,
  CreateAccountRequestDto,
  ListAccountRequestsQueryDto,
  RejectAccountRequestDto,
} from './dto/account-request.dto';

const userReference = { select: { id: true, fullName: true } } as const;

const accountRequestSelect = {
  id: true,
  status: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  requestedRole: { select: { code: true } },
  user: { select: userDetailSelect },
  submittedBy: userReference,
  approval: {
    select: { decision: true, reason: true, decidedAt: true, decidedBy: userReference },
  },
} satisfies Prisma.AccountRequestSelect;

type AccountRequestRecord = Prisma.AccountRequestGetPayload<{
  select: typeof accountRequestSelect;
}>;

@Injectable()
export class AccountRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: UserProvisioningService,
    private readonly notifications: NotificationPublisher,
    private readonly emailVerification: EmailVerificationService,
    private readonly accountEmail: AccountEmailService,
  ) {}

  /** A facilitator or admin registers a farmer who then awaits approval. */
  async create(
    dto: CreateAccountRequestDto,
    actor: AuthenticatedUser,
  ): Promise<AccountRequestResponseDto> {
    const { farmerType, farmerCategory, location, notes, ...account } = dto;
    const role = farmerRoleFor(farmerType);
    const { accountRequestId } = await this.provisioning.provision({
      ...account,
      roles: [role],
      status: UserStatus.PENDING,
      createdById: actor.id,
      location,
      farmer: { farmerType, farmerCategory },
      accountRequest: { requestedRole: role, submittedById: actor.id, notes },
    });
    return this.findOne(accountRequestId as string);
  }

  async list(query: ListAccountRequestsQueryDto): Promise<Paginated<AccountRequestResponseDto>> {
    const where: Prisma.AccountRequestWhereInput = {
      status: query.status,
      user: { deletedAt: null, ...(query.search ? { OR: searchConditions(query.search) } : {}) },
    };
    if (query.requestedRole) where.requestedRole = { code: query.requestedRole };

    const [requests, total] = await this.prisma.$transaction([
      this.prisma.accountRequest.findMany({
        where,
        select: accountRequestSelect,
        // Oldest first so the review queue is worked in order of arrival.
        orderBy: { createdAt: 'asc' },
        ...paginationArgs(query),
      }),
      this.prisma.accountRequest.count({ where }),
    ]);
    return paginated(requests.map(toAccountRequestResponse), total, query);
  }

  async findOne(id: string): Promise<AccountRequestResponseDto> {
    const request = await this.prisma.accountRequest.findUnique({
      where: { id },
      select: accountRequestSelect,
    });
    if (!request) throw new NotFoundException('Account request not found');
    return toAccountRequestResponse(request);
  }

  async approve(
    id: string,
    dto: ApproveAccountRequestDto,
    actor: AuthenticatedUser,
  ): Promise<AccountRequestResponseDto> {
    const { userId: applicantId, role } = await this.decide(
      id,
      actor,
      ApprovalDecision.APPROVED,
      dto.note ?? null,
    );
    // Approval alone does not allow sign-in: the applicant must still verify the personal email.
    const { emailSent } = await this.emailVerification.issue(
      applicantId,
      role === RoleCode.Facilitator ? 'approval' : 'staff-created',
    );
    await this.notifications.notifyEvent(
      NotificationEvent.AccountApproved,
      applicantId,
      {},
      {
        entity: { type: 'account-request', id },
        dedupeKey: `account-request:${id}:decision`,
      },
    );
    return { ...(await this.findOne(id)), emailSent };
  }

  async reject(
    id: string,
    dto: RejectAccountRequestDto,
    actor: AuthenticatedUser,
  ): Promise<AccountRequestResponseDto> {
    const { userId: applicantId } = await this.decide(
      id,
      actor,
      ApprovalDecision.REJECTED,
      dto.reason,
    );
    await this.notifications.notifyEvent(
      NotificationEvent.AccountRejected,
      applicantId,
      { reason: dto.reason.length > 250 ? `${dto.reason.slice(0, 249)}…` : dto.reason },
      { entity: { type: 'account-request', id }, dedupeKey: `account-request:${id}:decision` },
    );
    // Rejected applicants get the outcome by email; no verification link is issued.
    const applicant = await this.prisma.user.findUnique({
      where: { id: applicantId },
      select: { email: true, preferredLanguage: true },
    });
    const outcome = applicant?.email
      ? await this.accountEmail.sendRejection({
          userId: applicantId,
          to: applicant.email,
          language: applicant.preferredLanguage,
          reason: dto.reason,
        })
      : { delivered: false };
    return { ...(await this.findOne(id)), emailSent: outcome.delivered };
  }

  private async decide(
    id: string,
    actor: AuthenticatedUser,
    decision: ApprovalDecision,
    reason: string | null,
  ): Promise<{ userId: string; role: RoleCode }> {
    const approved = decision === ApprovalDecision.APPROVED;
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const request = await tx.accountRequest.findUnique({
        where: { id },
        select: { status: true, userId: true, requestedRole: { select: { code: true } } },
      });
      if (!request) throw new NotFoundException('Account request not found');

      // Conditional update: two administrators deciding at once cannot both succeed.
      const { count } = await tx.accountRequest.updateMany({
        where: { id, status: AccountRequestStatus.PENDING },
        data: { status: approved ? AccountRequestStatus.APPROVED : AccountRequestStatus.REJECTED },
      });
      if (count === 0) {
        throw new ConflictException(
          `This account request has already been ${request.status.toLowerCase()}`,
        );
      }

      await tx.accountApproval.create({
        data: { accountRequestId: id, decision, decidedById: actor.id, reason, decidedAt: now },
      });
      await tx.user.update({
        where: { id: request.userId },
        data: {
          status: approved ? UserStatus.ACTIVE : UserStatus.REJECTED,
          statusReason: approved ? null : reason,
          statusChangedAt: now,
          statusChangedById: actor.id,
        },
      });
      if (!approved) {
        await tx.refreshToken.updateMany({
          where: { userId: request.userId, revokedAt: null },
          data: { revokedAt: now, revokedReason: TokenRevocationReason.ACCOUNT_DISABLED },
        });
        await revokeActiveWebSessions(tx, { userId: request.userId }, TokenRevocationReason.ACCOUNT_DISABLED);
      }
      return { userId: request.userId, role: request.requestedRole.code as RoleCode };
    });
  }
}

function toAccountRequestResponse(request: AccountRequestRecord): AccountRequestResponseDto {
  return {
    id: request.id,
    status: request.status,
    requestedRole: request.requestedRole.code as RoleCode,
    notes: request.notes,
    applicant: toUserDetailResponse(request.user),
    submittedBy: request.submittedBy ?? null,
    decision: request.approval ?? null,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}
