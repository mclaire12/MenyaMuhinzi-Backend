import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { FacilitatorsController } from './facilitators.controller';
import { FacilitatorsService } from './facilitators.service';

@Module({
  imports: [UsersModule],
  controllers: [FacilitatorsController],
  providers: [FacilitatorsService],
  exports: [FacilitatorsService],
})
export class FacilitatorsModule {}
