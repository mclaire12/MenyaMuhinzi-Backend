import { AccountRequestsModule } from './account-requests/account-requests.module';
import { AuthModule } from './auth/auth.module';
import { RolesModule } from './roles/roles.module';
import { UsersModule } from './users/users.module';
import { FarmersModule } from './farmers/farmers.module';
import { FacilitatorsModule } from './facilitators/facilitators.module';
import { GroupsModule } from './groups/groups.module';
import { CoursesModule } from './courses/courses.module';
import { CropsModule } from './crops/crops.module';
import { LessonsModule } from './lessons/lessons.module';
import { TeachingMaterialsModule } from './teaching-materials/teaching-materials.module';
import { EnrollmentsModule } from './enrollments/enrollments.module';
import { ProgressModule } from './progress/progress.module';
import { AssessmentsModule } from './assessments/assessments.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { AiModule } from './ai/ai.module';
import { MediaModule } from './media/media.module';
import { UssdModule } from './ussd/ussd.module';
import { IvrModule } from './ivr/ivr.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportsModule } from './reports/reports.module';
import { AuditModule } from './audit/audit.module';
import { SettingsModule } from './settings/settings.module';

/**
 * Business domain modules. Modules that are still empty shells are
 * implemented in their own phase.
 */
export const FEATURE_MODULES = [
  AuthModule,
  UsersModule,
  RolesModule,
  AccountRequestsModule,
  FarmersModule,
  FacilitatorsModule,
  CropsModule,
  GroupsModule,
  CoursesModule,
  LessonsModule,
  TeachingMaterialsModule,
  EnrollmentsModule,
  ProgressModule,
  AssessmentsModule,
  KnowledgeModule,
  AiModule,
  MediaModule,
  UssdModule,
  IvrModule,
  NotificationsModule,
  ReportsModule,
  AuditModule,
  SettingsModule,
];
