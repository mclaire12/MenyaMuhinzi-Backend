import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { reportsConfig } from '../../../config/configuration';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { assertCsvRowLimit, toCsv } from '../common/csv';
import { ReportAuditAction, ReportAuditEntity } from '../reports.constants';
import { AdminReportsService } from './admin-reports.service';
import type { ReportFilterQueryDto } from '../dto/report-query.dto';

export interface CsvExport {
  filename: string;
  body: string;
}

@Injectable()
export class ReportExportService {
  constructor(
    private readonly admin: AdminReportsService,
    private readonly audit: AuditService,
    @Inject(reportsConfig.KEY) private readonly config: ConfigType<typeof reportsConfig>,
  ) {}

  async registrations(actor: AuthenticatedUser, query: ReportFilterQueryDto): Promise<CsvExport> {
    const rows = await this.admin.registrationRows(query);
    assertCsvRowLimit(rows.length, this.config.csvMaxRows);
    const body = toCsv(
      [
        'userId',
        'status',
        'createdAt',
        'preferredLanguage',
        'farmerType',
        'farmerCategory',
        'province',
        'district',
      ],
      rows.map((row) => [
        row.id,
        row.status,
        row.createdAt.toISOString(),
        row.preferredLanguage,
        row.farmerProfile?.farmerType ?? '',
        row.farmerProfile?.farmerCategory ?? '',
        row.location?.province ?? '',
        row.location?.district ?? '',
      ]),
    );
    await this.audit.record({
      actorId: actor.id,
      action: ReportAuditAction.Exported,
      entityType: ReportAuditEntity.Report,
      entityId: 'registrations',
      details: { format: 'csv', rows: rows.length },
    });
    return { filename: 'registrations-report.csv', body };
  }

  async notifications(actor: AuthenticatedUser, query: ReportFilterQueryDto): Promise<CsvExport> {
    const report = await this.admin.notifications(query);
    const rows = [
      ...report.byCategory.map((row) => ['category', row.key, row.count]),
      ...report.deliveriesByChannel.map((row) => ['channel', row.key, row.count]),
      ...report.deliveriesByStatus.map((row) => ['status', row.key, row.count]),
    ];
    assertCsvRowLimit(rows.length, this.config.csvMaxRows);
    const body = toCsv(['dimension', 'key', 'count'], rows);
    await this.audit.record({
      actorId: actor.id,
      action: ReportAuditAction.Exported,
      entityType: ReportAuditEntity.Report,
      entityId: 'notifications',
      details: { format: 'csv', rows: rows.length },
    });
    return { filename: 'notifications-report.csv', body };
  }
}
