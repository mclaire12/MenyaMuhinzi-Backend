import { Module } from '@nestjs/common';
import { TelephonyModule } from '../telephony/telephony.module';
import { AdminUssdController } from './controllers/admin-ussd.controller';
import { UssdCallbackController } from './controllers/ussd-callback.controller';
import { USSD_GATEWAY_PROVIDERS } from './gateway/ussd-gateway.interfaces';
import { UssdGatewayRegistry } from './gateway/ussd-gateway.registry';
import { UssdAnalyticsService } from './ussd-analytics.service';
import { UssdGatewayService } from './ussd-gateway.service';
import { UssdSessionService } from './ussd-session.service';

@Module({
  imports: [TelephonyModule],
  controllers: [UssdCallbackController, AdminUssdController],
  providers: [
    UssdGatewayRegistry,
    UssdSessionService,
    UssdGatewayService,
    UssdAnalyticsService,
  // No USSD aggregator is integrated: callbacks are accepted only when a provider adapter is registered.
    { provide: USSD_GATEWAY_PROVIDERS, useValue: [] },
  ],
})
export class UssdModule {}