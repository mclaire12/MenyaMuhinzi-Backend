import { ConflictException, Injectable } from '@nestjs/common';
import { KnowledgeReviewAction, KnowledgeSourceStatus } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import type { KnowledgeSourceResponseDto } from '../dto/knowledge-source.dto';
import { AuditEntity, KnowledgeAuditAction } from '../knowledge.constants';
import { KnowledgeSourcesService } from './knowledge-sources.service';
import { syncSourceStatus } from './source-status';

/**
 * Review workflow for the latest version: PROCESSED -> PENDING_REVIEW -> APPROVED or REJECTED.
 * Approving a new version archives the previous approved one; nothing is overwritten.
 */
@Injectable()
export class KnowledgeReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: KnowledgeSourcesService,
    private readonly audit: AuditService,
  ) {}

  async submit(id: string, actor: AuthenticatedUser): Promise<KnowledgeSourceResponseDto> {
    const source = await this.sources.requireSource(id);
    if (source.archivedAt) throw new ConflictException('Archived sources cannot be reviewed');
    const version = source.versions[0];
    if (version?.status !== KnowledgeSourceStatus.PROCESSED) {
      throw new ConflictException('Only a processed version can be submitted for review');
    }
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.knowledgeSourceVersion.updateMany({
        where: { id: version.id, status: KnowledgeSourceStatus.PROCESSED },
        data: { status: KnowledgeSourceStatus.PENDING_REVIEW, submittedAt: new Date() },
      });
      if (moved.count === 0)
        throw new ConflictException('The version changed. Reload and try again.');
      await tx.knowledgeApproval.create({
        data: {
          sourceId: id,
          versionId: version.id,
          action: KnowledgeReviewAction.SUBMITTED,
          actorId: actor.id,
        },
      });
      await syncSourceStatus(tx, id);
      await this.audit.record(
        {
          actorId: actor.id,
          action: KnowledgeAuditAction.ReviewSubmitted,
          entityType: AuditEntity.Source,
          entityId: id,
          details: { versionId: version.id, versionNumber: version.versionNumber },
        },
        tx,
      );
    });
    return this.sources.findOne(id, actor);
  }

  async approve(
    id: string,
    reason: string | undefined,
    actor: AuthenticatedUser,
  ): Promise<KnowledgeSourceResponseDto> {
    const source = await this.sources.requireSource(id);
    if (source.archivedAt) throw new ConflictException('Archived sources cannot be approved');
    const version = source.versions[0];
    if (version?.status !== KnowledgeSourceStatus.PENDING_REVIEW) {
      throw new ConflictException('Only a version waiting for review can be approved');
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.knowledgeSourceVersion.updateMany({
        where: { id: version.id, status: KnowledgeSourceStatus.PENDING_REVIEW },
        data: {
          status: KnowledgeSourceStatus.APPROVED,
          reviewedById: actor.id,
          reviewedAt: now,
          reviewReason: reason ?? null,
        },
      });
      if (moved.count === 0)
        throw new ConflictException('The version changed. Reload and try again.');

      const previous = source.approvedVersionId;
      if (previous && previous !== version.id) {
        await tx.knowledgeSourceVersion.update({
          where: { id: previous },
          data: { status: KnowledgeSourceStatus.ARCHIVED },
        });
        await tx.knowledgeApproval.create({
          data: {
            sourceId: id,
            versionId: previous,
            action: KnowledgeReviewAction.SUPERSEDED,
            actorId: actor.id,
            reason: `Replaced by version ${version.versionNumber}`,
          },
        });
      }
      await tx.knowledgeApproval.create({
        data: {
          sourceId: id,
          versionId: version.id,
          action: KnowledgeReviewAction.APPROVED,
          actorId: actor.id,
          reason,
        },
      });
      await tx.knowledgeSource.update({
        where: { id },
        data: { approvedVersionId: version.id, approvedById: actor.id, approvedAt: now },
      });
      await syncSourceStatus(tx, id);
      await this.audit.record(
        {
          actorId: actor.id,
          action: KnowledgeAuditAction.Approved,
          entityType: AuditEntity.Source,
          entityId: id,
          details: {
            versionId: version.id,
            versionNumber: version.versionNumber,
            supersededVersionId: previous,
          },
        },
        tx,
      );
    });
    return this.sources.findOne(id, actor);
  }

  /** The previous approved version, if any, stays in use. */
  async reject(
    id: string,
    reason: string,
    actor: AuthenticatedUser,
  ): Promise<KnowledgeSourceResponseDto> {
    const source = await this.sources.requireSource(id);
    const version = source.versions[0];
    if (version?.status !== KnowledgeSourceStatus.PENDING_REVIEW) {
      throw new ConflictException('Only a version waiting for review can be rejected');
    }
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.knowledgeSourceVersion.updateMany({
        where: { id: version.id, status: KnowledgeSourceStatus.PENDING_REVIEW },
        data: {
          status: KnowledgeSourceStatus.REJECTED,
          reviewedById: actor.id,
          reviewedAt: new Date(),
          reviewReason: reason,
        },
      });
      if (moved.count === 0)
        throw new ConflictException('The version changed. Reload and try again.');
      await tx.knowledgeApproval.create({
        data: {
          sourceId: id,
          versionId: version.id,
          action: KnowledgeReviewAction.REJECTED,
          actorId: actor.id,
          reason,
        },
      });
      await syncSourceStatus(tx, id);
      await this.audit.record(
        {
          actorId: actor.id,
          action: KnowledgeAuditAction.Rejected,
          entityType: AuditEntity.Source,
          entityId: id,
          details: { versionId: version.id, versionNumber: version.versionNumber, reason },
        },
        tx,
      );
    });
    return this.sources.findOne(id, actor);
  }

  /** Removes the source from retrieval while keeping every version and its history. */
  async archive(
    id: string,
    reason: string | undefined,
    actor: AuthenticatedUser,
  ): Promise<KnowledgeSourceResponseDto> {
    const source = await this.sources.requireSource(id);
    if (source.archivedAt) throw new ConflictException('The source is already archived');
    if (source.versions.some((version) => version.status === KnowledgeSourceStatus.PROCESSING)) {
      throw new ConflictException('Wait for processing to finish before archiving');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeSource.update({ where: { id }, data: { archivedAt: new Date() } });
      await tx.knowledgeApproval.create({
        data: {
          sourceId: id,
          versionId: source.approvedVersionId,
          action: KnowledgeReviewAction.ARCHIVED,
          actorId: actor.id,
          reason,
        },
      });
      await syncSourceStatus(tx, id);
      await this.audit.record(
        {
          actorId: actor.id,
          action: KnowledgeAuditAction.SourceArchived,
          entityType: AuditEntity.Source,
          entityId: id,
          details: { reason },
        },
        tx,
      );
    });
    return this.sources.findOne(id, actor);
  }
}
