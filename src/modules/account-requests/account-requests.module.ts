import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AccountRequestsController } from './account-requests.controller';
import { AccountRequestsService } from './account-requests.service';

@Module({
  imports: [NotificationsModule, UsersModule],
  controllers: [AccountRequestsController],
  providers: [AccountRequestsService],
})
export class AccountRequestsModule {}
