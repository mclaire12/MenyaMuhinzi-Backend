import { Module } from '@nestjs/common';
import { TelephonyModule } from '../telephony/telephony.module';
import { AdminIvrController } from './controllers/admin-ivr.controller';
import { IvrCallbackController } from './controllers/ivr-callback.controller';
import { IVR_GATEWAY_PROVIDERS } from './gateway/ivr-gateway.interfaces';
import { IvrGatewayRegistry } from './gateway/ivr-gateway.registry';
import { IvrAnalyticsService } from './ivr-analytics.service';
import { IvrAudioService } from './ivr-audio.service';
import { IvrGatewayService } from './ivr-gateway.service';
import { IvrSessionService } from './ivr-session.service';

@Module({
  imports: [TelephonyModule],
  controllers: [IvrCallbackController, AdminIvrController],
  providers: [
    IvrGatewayRegistry,
    IvrSessionService,
    IvrGatewayService,
    IvrAnalyticsService,
    IvrAudioService,
    { provide: IVR_GATEWAY_PROVIDERS, useValue: [] },
  ],
})
export class IvrModule {}