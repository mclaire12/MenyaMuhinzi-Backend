export const ReportAuditAction = {
  Exported: 'REPORT_EXPORTED',
} as const;

export const ReportAuditEntity = {
  Report: 'Report',
} as const;

/** Series bucket for time-series report rows. */
export type ReportBucket = 'day' | 'week' | 'month';

export const DEFAULT_REPORT_BUCKET: ReportBucket = 'day';
