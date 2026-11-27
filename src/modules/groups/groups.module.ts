import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { GroupMemberRegistrationService } from './group-member-registration.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminGroupsController } from './admin-groups.controller';
import { AdminGroupsService } from './admin-groups.service';
import { FacilitatorGroupsController } from './facilitator-groups.controller';
import { FacilitatorGroupsService } from './facilitator-groups.service';
import { GroupCoursesService } from './group-courses.service';

@Module({
  imports: [NotificationsModule, UsersModule],
  controllers: [AdminGroupsController, FacilitatorGroupsController],
  providers: [
    AdminGroupsService,
    FacilitatorGroupsService,
    GroupCoursesService,
    GroupMemberRegistrationService,
  ],
})
export class GroupsModule {}
