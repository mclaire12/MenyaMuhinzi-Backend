import { Module } from '@nestjs/common';
import { PasswordHasher } from '../auth/services/password-hasher.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AccountEmailService } from './account-email.service';
import { EmailVerificationService } from './email-verification.service';
import { UserProvisioningService } from './user-provisioning.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [NotificationsModule],
  controllers: [UsersController],
  providers: [
    UsersService,
    UserProvisioningService,
    PasswordHasher,
    AccountEmailService,
    EmailVerificationService,
  ],
  exports: [
    UsersService,
    UserProvisioningService,
    PasswordHasher,
    AccountEmailService,
    EmailVerificationService,
  ],
})
export class UsersModule {}
