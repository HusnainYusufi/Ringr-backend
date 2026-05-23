import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { GeoModule } from '../geo/geo.module';
import { RetellWebhookGuard } from '../common/guards/retell-webhook.guard';

// No AuthModule dependency — the voice flow no longer does OTP. Customers
// are identified by call.from_number and upserted on the first tool call.
@Module({
  imports: [
    GeoModule,
    BullModule.registerQueue({ name: 'slot-management' }),
  ],
  controllers: [VoiceController],
  providers: [VoiceService, RetellWebhookGuard],
})
export class VoiceModule {}
