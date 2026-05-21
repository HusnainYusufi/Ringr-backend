import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { GeoModule } from '../geo/geo.module';
import { AuthModule } from '../auth/auth.module';
import { RetellWebhookGuard } from '../common/guards/retell-webhook.guard';

@Module({
  imports: [
    GeoModule,
    AuthModule,
    BullModule.registerQueue(
      { name: 'slot-management' },
      { name: 'notifications' },
    ),
  ],
  controllers: [VoiceController],
  providers: [VoiceService, RetellWebhookGuard],
})
export class VoiceModule {}
