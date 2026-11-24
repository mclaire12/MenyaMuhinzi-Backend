import { Module } from '@nestjs/common';
import { AssessmentsModule } from '../assessments/assessments.module';
import { CoursesModule } from '../courses/courses.module';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { ProgressModule } from '../progress/progress.module';
import { AUDIO_PROVIDERS } from './audio-provider.interfaces';
import { FarmerIdentityService } from './farmer-identity.service';
import { TelephonyLearningService } from './telephony-learning.service';
import { TelephonySettingsService } from './telephony-settings.service';

@Module({
  imports: [AssessmentsModule, CoursesModule, EnrollmentsModule, ProgressModule],
  providers: [
    FarmerIdentityService,
    TelephonyLearningService,
    TelephonySettingsService,
    // No audio provider is integrated: IVR lesson playback is reported as unavailable.
    { provide: AUDIO_PROVIDERS, useValue: [] },
  ],
  exports: [
    FarmerIdentityService,
    TelephonyLearningService,
    TelephonySettingsService,
    AUDIO_PROVIDERS,
  ],
})
export class TelephonyModule {}
