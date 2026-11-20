import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminGroupsController } from './admin-groups.controller';
import { AdminGroupsService } from './admin-groups.service';
import { FacilitatorGroupsController } from './facilitator-groups.controller';
import { FacilitatorGroupsService } from './facilitator-groups.service';
import { GroupCoursesService } from './group-courses.service';

@Module({
  imports: [NotificationsModule],
  controllers: [AdminGroupsController, FacilitatorGroupsController],
  providers: [AdminGroupsService, FacilitatorGroupsService, GroupCoursesService],
})
export class GroupsModule {}
