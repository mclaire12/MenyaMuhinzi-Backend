import { Module } from '@nestjs/common';
import { AdminReportsController } from './controllers/admin-reports.controller';
import { FacilitatorReportsController } from './controllers/facilitator-reports.controller';
import { FarmerReportsController } from './controllers/farmer-reports.controller';
import { ReportScopeService } from './common/report-scope.service';
import { AdminReportsService } from './services/admin-reports.service';
import { FacilitatorReportsService } from './services/facilitator-reports.service';
import { FarmerReportsService } from './services/farmer-reports.service';
import { ReportExportService } from './services/report-export.service';

@Module({
  controllers: [AdminReportsController, FacilitatorReportsController, FarmerReportsController],
  providers: [
    ReportScopeService,
    AdminReportsService,
    FacilitatorReportsService,
    FarmerReportsService,
    ReportExportService,
  ],
})
export class ReportsModule {}
