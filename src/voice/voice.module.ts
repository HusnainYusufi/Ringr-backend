import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { WebCallController } from './web-call.controller';
import { GeoModule } from '../geo/geo.module';
import { RetellWebhookGuard } from '../common/guards/retell-webhook.guard';

@Module({
  imports: [
    GeoModule,
    BullModule.registerQueue({ name: 'slot-management' }),
  ],
  controllers: [VoiceController, WebCallController],
  providers: [VoiceService, RetellWebhookGuard],
})
export class VoiceModule {}
